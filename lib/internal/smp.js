const EventEmitter = require('events');
const util = require('util');
const crypto = require('crypto');

const utils = require('./utils');
const storage = require('./storage');
const Errors = require('../errors');
const SmpErrors = require('../smp-errors');

const emptyBuffer = Buffer.alloc(0);

const SC_IS_SUPPORTED = true;

function xor(a, b) {
	var ret = Buffer.alloc(Math.min(a.length, b.length));
	for (var i = 0; i < ret.length; i++) {
		ret[i] = a[i] ^ b[i];
	}
	return ret;
}

function leftShift128(v) {
	var carry = 0;
	for (var i = 15; i >= 0; --i) {
		var nextCarry = v[i] >> 7;
		v[i] = (v[i] << 1) | carry;
		carry = nextCarry;
	}
	return carry;
}

function AESCMAC(key, message) {
	var zero = Buffer.alloc(16);
	var aes = crypto.createCipheriv('AES-128-ECB', key, emptyBuffer);
	var L = aes.update(zero);
	if (leftShift128(L)) {
		L[15] ^= 0x87;
	}
	var flag = true;
	if (message.length == 0 || message.length % 16 != 0) {
		if (leftShift128(L)) {
			L[15] ^= 0x87;
		}
		flag = false;
	}
	
	var X = zero;
	var n = (message.length + 15) >>> 4;
	var processed = 0;
	for (var i = 0; i < n - 1; i++) {
		X = aes.update(xor(X, message.slice(processed, processed + 16)));
		processed += 16;
	}
	var last = Buffer.alloc(16);
	message.copy(last, 0, processed);
	if (!flag) {
		last[message.length % 16] = 0x80;
	}
	return aes.update(xor(xor(X, L), last));
}

function timingSafeEqual(a, b) {
	return crypto.timingSafeEqual ? crypto.timingSafeEqual(a, b) : a.equals(b);
}

const Toolbox = {
	e: function(key, plaintextData) {
		return crypto.createCipheriv('AES-128-ECB', Buffer.from(key).reverse(), emptyBuffer).update(Buffer.from(plaintextData).reverse()).reverse();
	},
	ah: function(k, r) {
		var b = Buffer.alloc(16);
		r.copy(b);
		return Toolbox.e(k, b).slice(0, 3);
	},
	c1: function(k, r, pres, preq, iat, ia, rat, ra) {
		var p1 = Buffer.concat([Buffer.from([iat, rat]), preq, pres]);
		var p2 = Buffer.concat([ra, ia, Buffer.alloc(4)]);
		return Toolbox.e(k, xor(Toolbox.e(k, xor(r, p1)), p2));
	},
	s1: function(k, r1, r2) {
		r1 = r1.slice(0, 8);
		r2 = r2.slice(0, 8);
		var r = Buffer.concat([r2, r1]);
		return Toolbox.e(k, r);
	},
	f4: function(U, V, X, Z) {
		return AESCMAC(Buffer.from(X).reverse(), Buffer.concat([Buffer.from([Z]), V, U]).reverse()).reverse();
	},
	f5: function(W, N1, N2, A1, A2) {
		var SALT = Buffer.from('6C888391AAF5A53860370BDB5A6083BE', 'hex');
		var T = AESCMAC(SALT, Buffer.from(W).reverse());
		var v = Buffer.concat([Buffer.from('btle', 'utf8'), Buffer.from(N1).reverse(), Buffer.from(N2).reverse(), Buffer.from(A1).reverse(), Buffer.from(A2).reverse(), Buffer.from([1, 0])]);
		var macKey = AESCMAC(T, Buffer.concat([Buffer.from([0]), v])).reverse();
		var ltk = AESCMAC(T, Buffer.concat([Buffer.from([1]), v])).reverse();
		return [macKey, ltk];
	},
	f6: function(W, N1, N2, R, IOcap, A1, A2) {
		return AESCMAC(Buffer.from(W).reverse(), Buffer.concat([A2, A1, IOcap, R, N2, N1]).reverse()).reverse();
	},
	g2: function(U, V, X, Y) {
		return AESCMAC(Buffer.from(X).reverse(), Buffer.concat([Y, V, U]).reverse()).readUInt32BE(12);
	}
};

function bdAddrToBuffer(v) {
	var buf = Buffer.alloc(6);
	for (var i = 15, j = 0; i >= 0; i -= 3) {
		buf[j++] = parseInt(v.substr(i, 2), 16);
	}
	return buf;
}

function bufferToBdAddr(buffer) {
	var str = '';
	for (var i = 5; i >= 0; i--) {
		str += (0x100 + buffer[i]).toString(16).substr(-2).toUpperCase();
		if (i != 0) {
			str += ':';
		}
	}
	return str;
}

const SMP_PAIRING_REQUEST = 0x01;
const SMP_PAIRING_RESPONSE = 0x02;
const SMP_PAIRING_CONFIRM = 0x03;
const SMP_PAIRING_RANDOM = 0x04;
const SMP_PAIRING_FAILED = 0x05;
const SMP_ENCRYPTION_INFORMATION = 0x06;
const SMP_MASTER_IDENTIFICATION = 0x07;
const SMP_IDENTITY_INFORMATION = 0x08;
const SMP_IDENTITY_ADDRESS_INFORMATION = 0x09;
const SMP_SIGNING_INFORMATION = 0x0a;
const SMP_SECURITY_REQUEST = 0x0b;
const SMP_PAIRING_PUBLIC_KEY = 0x0c;
const SMP_DHKEY_CHECK = 0x0d;
const SMP_KEYPRESS_NOTIFICATION = 0x0e;

const STATE_IDLE = 0;
const STATE_W4_PACKET_ENQUEUED = 1;
const STATE_W4_PACKET = 2;
const STATE_W4_USER_FEATURES = 3;
const STATE_W4_USER_PASSKEY = 4;
const STATE_W4_USER_NUMERIC_COMPARISON = 5;
const STATE_W4_LTK_REQUEST = 6;
const STATE_W4_ENCRYPTION_STARTED = 7;
const STATE_CANCELLED_BY_PEER_AND_W4_ENCRYPTION_STARTED = 8;
const STATE_CANCELLED_BY_LOCAL_AND_W4_ENCRYPTION_STARTED = 9;
const STATE_W4_LAST_ACK = 9;
const STATE_TIMEDOUT = 40;

const IO_CAP_DISPLAY_ONLY = 0x00;
const IO_CAP_DISPLAY_YES_NO = 0x01;
const IO_CAP_KEYBOARD_ONLY = 0x02;
const IO_CAP_NO_INPUT_NO_OUTPUT = 0x03;
const IO_CAP_KEYBOARD_DISPLAY = 0x04;

const ASSOCIATION_MODEL_JUST_WORKS = 0;
const ASSOCIATION_MODEL_PASSKEY_ENTRY_INIT_INPUTS = 1;
const ASSOCIATION_MODEL_PASSKEY_ENTRY_RSP_INPUTS = 2;
const ASSOCIATION_MODEL_PASSKEY_ENTRY_BOTH_INPUTS = 3;
const ASSOCIATION_MODEL_NUMERIC_COMPARISON = 4;

// TODO: to get autocomplete
({	PASSKEY_ENTRY_FAILED: 0x01,
	OOB_NOT_AVAILABLE: 0x02,
	AUTHENTICATION_REQUIREMENTS: 0x03,
	CONFIRM_VALUE_FAILED: 0x04,
	PAIRING_NOT_SUPPORTED: 0x05,
	ENCRYPTION_KEY_SIZE: 0x06,
	COMMAND_NOT_SUPPORTED: 0x07,
	UNSPECIFIED_REASON: 0x08,
	REPEATED_ATTEMPTS: 0x09,
	INVALID_PARAMETERS: 0x0a,
	DHKEY_CHECK_FAILED: 0x0b,
	NUMERIC_COMPARISON_FAILED: 0x0c,
	BR_EDR_PAIRING_IN_PROGRESS: 0x0d,
	CROSS_TRANSPORT_KEY_DERIVATION_GENERATION_NOT_ALLOWED: 0x0e,
});

const myEcdh = crypto.createECDH('prime256v1');
myEcdh.generateKeys();
const myEcdhPubKey = {x: myEcdh.getPublicKey().slice(1, 33).reverse(), y: myEcdh.getPublicKey().slice(33, 65).reverse()};

function parsePairingReqRsp(data, freeze) {
	var filter = freeze ? Object.freeze : v => v;
	return filter({
		ioCap: data[1] <= IO_CAP_KEYBOARD_DISPLAY ? data[1] : IO_CAP_NO_INPUT_NO_OUTPUT,
		bondingFlags: data[3] & 3,
		mitm: (data[3] & 4) != 0,
		sc: (data[3] & 8) != 0,
		keypress: (data[3] & 16) != 0,
		maxKeySize: data[4],
		initKeyDistr: filter({
			encKey: (data[5] & 1) != 0,
			idKey: (data[5] & 2) != 0
		}),
		rspKeyDistr: filter({
			encKey: (data[6] & 1) != 0,
			idKey: (data[6] & 2) != 0
		})
	});
}

function fixFeaturesFromUser(rsp) {
	if (typeof rsp !== 'object' || rsp === null) {
		rsp = Object.create(null);
	}
	var rspIoCap = rsp.ioCap;
	var rspMaxKeySize = rsp.maxKeySize;
	var rspInitKeyDistr = rsp.initKeyDistr;
	var rspRspKeyDistr = rsp.rspKeyDistr;
	
	var rspBondingFlags = rsp.bondingFlags;
	var rspMitm = rsp.mitm;
	var rspKeypress = rsp.keypress;
	if (typeof rspInitKeyDistr !== 'object' || rspInitKeyDistr === null) {
		rspInitKeyDistr = Object.create(null);
	}
	var rspInitEncKey = rspInitKeyDistr.encKey;
	var rspInitIdKey = rspInitKeyDistr.idKey;
	if (typeof rspRspKeyDistr !== 'object' || rspRspKeyDistr === null) {
		rspRspKeyDistr = Object.create(null);
	}
	var rspRspEncKey = rspRspKeyDistr.encKey;
	var rspRspIdKey = rspRspKeyDistr.idKey;
	
	return {
		ioCap: Number.isInteger(rspIoCap) && rspIoCap >= 0 && rspIoCap <= 0x04 ? rspIoCap : IO_CAP_NO_INPUT_NO_OUTPUT,
		bondingFlags: rspBondingFlags === 0 ? 0 : 1,
		mitm: rspMitm === true,
		sc: SC_IS_SUPPORTED,
		keypress: rspKeypress === true,
		maxKeySize: Number.isInteger(rspMaxKeySize) && rspMaxKeySize >= 7 && rspMaxKeySize <= 16 ? rspMaxKeySize : 16,
		initKeyDistr: {
			encKey: rspInitEncKey !== false,
			idKey: rspInitIdKey !== false
		},
		rspKeyDistr: {
			encKey: rspRspEncKey !== false,
			idKey: rspRspIdKey !== false
		}
	};
}

function buildPairingFeaturesPacket(opcode, rsp) {
	var authReq = rsp.bondingFlags | (rsp.mitm << 2) | (rsp.sc << 3) | (rsp.keypress << 4);
	var initKeyDistr = rsp.initKeyDistr.encKey | (rsp.initKeyDistr.idKey << 1);
	var rspKeyDistr = rsp.rspKeyDistr.encKey | (rsp.rspKeyDistr.idKey << 1);
	return Buffer.from([opcode, rsp.ioCap, 0, authReq, rsp.maxKeySize, initKeyDistr, rspKeyDistr]);
}

function bitwiseAndKeys(rsp, req) {
	rsp.initKeyDistr.encKey = rsp.initKeyDistr.encKey && req.initKeyDistr.encKey;
	rsp.initKeyDistr.idKey = rsp.initKeyDistr.idKey && req.initKeyDistr.idKey;
	rsp.rspKeyDistr.encKey = rsp.rspKeyDistr.encKey && req.rspKeyDistr.encKey;
	rsp.rspKeyDistr.idKey = rsp.rspKeyDistr.idKey && req.rspKeyDistr.idKey;
}

function combineAuthReq(pairingFeatures, req) {
	pairingFeatures.bondingFlags &= (req.bondingFlags >= 1); // How to treat RFU?
	pairingFeatures.mitm = pairingFeatures.mitm || req.mitm;
	pairingFeatures.sc = pairingFeatures.sc && req.sc;
	pairingFeatures.keypress = pairingFeatures.keypress && req.keypress;
	pairingFeatures.maxKeySize = Math.min(pairingFeatures.maxKeySize, req.maxKeySize);
}

function getAssociationModel(init, rsp, sc, mitm) {
	if (!mitm) {
		return ASSOCIATION_MODEL_JUST_WORKS;
	}
	if (!sc) {
		if (init == IO_CAP_DISPLAY_YES_NO) {
			init = IO_CAP_DISPLAY_ONLY;
		}
		if (rsp == IO_CAP_DISPLAY_YES_NO) {
			rsp = IO_CAP_DISPLAY_ONLY;
		}
	}
	if (init == IO_CAP_NO_INPUT_NO_OUTPUT || rsp == IO_CAP_NO_INPUT_NO_OUTPUT) {
		return ASSOCIATION_MODEL_JUST_WORKS;
	} else if (init == IO_CAP_KEYBOARD_ONLY && rsp == IO_CAP_KEYBOARD_ONLY) {
		return ASSOCIATION_MODEL_PASSKEY_ENTRY_BOTH_INPUTS;
	} else if (init == IO_CAP_KEYBOARD_ONLY) {
		return ASSOCIATION_MODEL_PASSKEY_ENTRY_INIT_INPUTS;
	} else if (rsp == IO_CAP_KEYBOARD_ONLY) {
		return ASSOCIATION_MODEL_PASSKEY_ENTRY_RSP_INPUTS;
	} else if (init == IO_CAP_KEYBOARD_DISPLAY && rsp == IO_CAP_KEYBOARD_DISPLAY) {
		return sc ? ASSOCIATION_MODEL_NUMERIC_COMPARISON : ASSOCIATION_MODEL_PASSKEY_ENTRY_RSP_INPUTS;
	} else if (init == IO_CAP_DISPLAY_ONLY && rsp == IO_CAP_KEYBOARD_DISPLAY) {
		return ASSOCIATION_MODEL_PASSKEY_ENTRY_RSP_INPUTS;
	} else if (rsp == IO_CAP_DISPLAY_ONLY && init == IO_CAP_KEYBOARD_DISPLAY) {
		return ASSOCIATION_MODEL_PASSKEY_ENTRY_INIT_INPUTS;
	} else if (init == IO_CAP_DISPLAY_ONLY || rsp == IO_CAP_DISPLAY_ONLY) {
		return ASSOCIATION_MODEL_JUST_WORKS;
	}
	return ASSOCIATION_MODEL_NUMERIC_COMPARISON;
}

function passkeyToTk(passkey) {
	var key = Buffer.alloc(16);
	key.writeUInt32LE(passkey);
	return key;
}

function generateLtkEaEb(peerPublicKey, ia, iat, ra, rat, initRandomValue, rspRandomValue, userPasskey, maxKeySize, IOCapA, IOCapB) {
	var sharedSecret = null;
	var buf = Buffer.alloc(65);
	buf[0] = 0x04;
	for (var i = 0; i < 32; i++) {
		buf[1 + i] = peerPublicKey.x[31 - i];
		buf[33 + i] = peerPublicKey.y[31 - i];
	}
	try {
		sharedSecret = myEcdh.computeSecret(buf).reverse();
	} catch (e) {
		// computeSecret throws error if the point does not lie on the curve
		return null;
	}
	var A = Buffer.concat([ia, Buffer.from([iat])]);
	var B = Buffer.concat([ra, Buffer.from([rat])]);
	var keys = Toolbox.f5(sharedSecret, initRandomValue, rspRandomValue, A, B);
	var macKey = keys[0];
	var ltk = keys[1].slice(0, maxKeySize);
	var Ea = Toolbox.f6(macKey, initRandomValue, rspRandomValue, passkeyToTk(userPasskey), IOCapA, A, B);
	var Eb = Toolbox.f6(macKey, rspRandomValue, initRandomValue, passkeyToTk(userPasskey), IOCapB, B, A);
	return {ltk: ltk, Ea: Ea, Eb: Eb};
}

function padKey(key) {
	var buf = Buffer.alloc(16);
	key.copy(buf);
	return buf;
}

function SmpSlaveConnection(connection, registerOnDataFn, sendDataFn, registerLtkRequestFn, updateIdentityAddressFn, bondDoneFn) {
	EventEmitter.call(this);
	var smp = this;
	
	var iat = connection.peerAddressType == 'random' ? 0x01 : 0x00;
	var ia = bdAddrToBuffer(connection.peerAddress);
	var rat = connection.ownAddressType == 'random' ? 0x01 : 0x00;
	var ra = bdAddrToBuffer(connection.ownAddress);
	
	var idGenerator = new utils.IdGenerator();
	
	var state = STATE_IDLE;
	var packetWaitOpcode;
	var timeoutClearFn = function() {};
	var runCounter = idGenerator.next();
	
	var pairingRequestData = null;
	var pairingResponseData = null;
	var pairingFeatures = null;
	var initIoCap;
	var associationModel;
	var userPasskey;
	
	var initConfirmValue;
	var initRandomValue;
	var rspRandomValue;
	var passkeyBitCounter;
	var numericComparisonOk;
	var peerPublicKey;
	var peerDHKeyCheck;
	var generatedLtk;
	
	var rspLtk;
	var rspEdivRand;
	var initEdivRand;
	var initLtk;
	var initIrk;
	var initIdentityAddressInformation;
	
	var availableLtk = null;
	var isBonded = false;
	var isEncrypted = false;
	var currentEncryptionLevel = null;
	
	function getAddressesForStorage() {
		var ownAddress = storage.constructAddress(connection.ownAddressType, connection.ownAddress);
		var peerAddress = connection.peerIdentityAddress ?
			storage.constructAddress(connection.peerIdentityAddressType, connection.peerIdentityAddress) :
			storage.constructAddress(connection.peerAddressType, connection.peerAddress);
		return [ownAddress, peerAddress];
	}
	
	(function() {
		var a = getAddressesForStorage();
		var keys = storage.getKeys(a[0], a[1]);
		if (keys) {
			var ltk = keys.localLtk;
			if (ltk) {
				availableLtk = {ltk: ltk.ltk, rand: ltk.rand, ediv: ltk.ediv, mitm: keys.mitm, sc: keys.sc};
				isBonded = true;
			}
		}
	})();
	
	function restartTimeout() {
		timeoutClearFn();
		timeoutClearFn = connection.setTimeout(function() {
			runCounter = idGenerator.next();
			state = STATE_TIMEDOUT;
			sendDataFn = function() {};
			if (smp.listenerCount('timeout') > 0) {
				smp.emit('timeout');
			} else {
				connection.disconnect();
			}
		}, 30000);
	}
	
	var hasOutgoingFailedMsg = false;
	function pairingFailed(reason) {
		timeoutClearFn();
		if (!hasOutgoingFailedMsg) {
			hasOutgoingFailedMsg = true;
			sendDataFn(Buffer.from([SMP_PAIRING_FAILED, reason]), function() {
				hasOutgoingFailedMsg = false;
			});
		}
		state = STATE_IDLE;
		runCounter = idGenerator.next();
		
		smp.emit('pairingFail', reason, false);
	}
	
	function pairingDone() {
		timeoutClearFn();
		state = STATE_IDLE;
		runCounter = idGenerator.next();
		var sc = pairingFeatures.sc;
		var res = {
			sc: sc,
			mitm: pairingFeatures.mitm && associationModel != ASSOCIATION_MODEL_JUST_WORKS,
			bond: pairingFeatures.bondingFlags != 0,
			rspRand: sc ? Buffer.alloc(8) : rspEdivRand ? rspEdivRand.slice(2) : null,
			rspEdiv: sc ? 0x0000 : rspEdivRand ? rspEdivRand.readUInt16LE(0) : null,
			rspLtk: sc ? generatedLtk : rspLtk,
			initRand: sc ? Buffer.alloc(8) : initEdivRand ? initEdivRand.slice(2) : null,
			initEdiv: sc ? 0x0000 : initEdivRand ? initEdivRand.readUInt16LE(0) : null,
			initLtk: sc ? generatedLtk : initLtk,
			initIrk: initIrk,
			initIdentityAddress: initIdentityAddressInformation
		};
		if (res.initIdentityAddress && res.initIdentityAddress.address != '00:00:00:00:00:00') {
			updateIdentityAddressFn(res.initIdentityAddress.addressType, res.initIdentityAddress.address);
		}
		if (res.bond) {
			var a = getAddressesForStorage();
			storage.storeKeys(a[0], a[1], res.mitm, res.sc, res.initIrk, res.rspLtk, res.rspRand, res.rspEdiv, res.initLtk, res.initRand, res.initEdiv);
			isBonded = true;
			bondDoneFn();
		}
		if (res.bond && res.rspLtk) {
			availableLtk = {ltk: Buffer.from(res.rspLtk), rand: Buffer.from(res.rspRand), ediv: res.rspEdiv, mitm: res.mitm, sc: res.sc};
		}
		smp.emit('pairingComplete', res);
	}
	
	function sendPacket(data, nextPacketOpcode, callback) {
		if (state == STATE_TIMEDOUT) {
			return;
		}
		restartTimeout();
		state = STATE_W4_PACKET_ENQUEUED;
		if (!callback) {
			packetWaitOpcode = nextPacketOpcode;
		}
		var thisRunCounter = runCounter;
		sendDataFn(data, function() {
			if (runCounter != thisRunCounter) {
				return;
			}
			if (callback) {
				callback();
			} else {
				state = STATE_W4_PACKET;
			}
		});
	}
	
	function onPairingRequest(req) {
		initIoCap = req.ioCap;
		
		runCounter = idGenerator.next();
		var thisRunCounter = runCounter;
		var userHandledRequest;
		state = STATE_W4_USER_FEATURES;
		if (smp.listenerCount('pairingRequest') > 0) {
			userHandledRequest = true;
			smp.emit('pairingRequest', req, cont);
		} else {
			userHandledRequest = false;
			cont(null);
		}
		function cont(rsp) {
			if (state != STATE_W4_USER_FEATURES || runCounter != thisRunCounter) {
				return;
			}
			rsp = fixFeaturesFromUser(rsp);
			bitwiseAndKeys(rsp, req);
			
			// We request bonding only if at least one key is to be distributed / generated
			//rsp.bondingFlags &= rsp.initKeyDistr.encKey || rsp.initKeyDistr.idKey || rsp.rspKeyDistr.encKey || rsp.rspKeyDistr.idKey || (rsp.sc && req.sc);
			
			pairingResponseData = buildPairingFeaturesPacket(SMP_PAIRING_RESPONSE, rsp);
			pairingFeatures = rsp;
			combineAuthReq(pairingFeatures, req);
			
			associationModel = getAssociationModel(req.ioCap, rsp.ioCap, pairingFeatures.sc, pairingFeatures.mitm);
			
			if (!userHandledRequest && isBonded && !isEncrypted && associationModel == ASSOCIATION_MODEL_JUST_WORKS) {
				pairingFailed(SmpErrors.AUTHENTICATION_REQUIREMENTS);
				return;
			}
			
			if (associationModel == ASSOCIATION_MODEL_PASSKEY_ENTRY_INIT_INPUTS) {
				userPasskey = crypto.randomBytes(4).readUInt32LE(0) % 1000000
			} else if (associationModel == ASSOCIATION_MODEL_JUST_WORKS || associationModel == ASSOCIATION_MODEL_NUMERIC_COMPARISON) {
				userPasskey = 0;
			} else {
				userPasskey = null;
			}
			
			rspLtk = null;
			rspEdivRand = null;
			initLtk = null;
			initEdivRand = null;
			initIrk = null;
			initIdentityAddressInformation = null;
			passkeyBitCounter = 0;
			
			sendPacket(pairingResponseData, pairingFeatures.sc ? SMP_PAIRING_PUBLIC_KEY : SMP_PAIRING_CONFIRM);
			
			if (associationModel != ASSOCIATION_MODEL_JUST_WORKS && associationModel != ASSOCIATION_MODEL_NUMERIC_COMPARISON) {
				var ignore = associationModel == ASSOCIATION_MODEL_PASSKEY_ENTRY_INIT_INPUTS;
				smp.emit('passkeyExchange', associationModel, userPasskey == null ? null : ("00000" + userPasskey).substr(-6), function(passkeyResponse) {
					if (ignore) {
						return;
					}
					if (typeof passkeyResponse === 'string' && /^\d{1,6}$/.test(passkeyResponse)) {
						passkeyResponse = passkeyResponse | 0;
					}
					if (!(Number.isInteger(passkeyResponse) && passkeyResponse >= 0 && passkeyResponse <= 999999)) {
						throw new Error('Invalid passkey format');
					}
					if (runCounter != thisRunCounter) {
						return;
					}
					if (userPasskey == null) {
						userPasskey = passkeyResponse;
						
						if (state == STATE_W4_USER_PASSKEY) {
							afterInitsConfirmAndPasskey();
						}
					}
				});
			}
		}
	}
	
	function afterInitsConfirmAndPasskey() {
		rspRandomValue = crypto.randomBytes(16);
		var rspConfirmValue;
		if (!pairingFeatures.sc) {
			rspConfirmValue = Toolbox.c1(passkeyToTk(userPasskey), rspRandomValue, pairingResponseData, pairingRequestData, iat, ia, rat, ra);
		} else {
			rspConfirmValue = Toolbox.f4(myEcdhPubKey.x, peerPublicKey.x, rspRandomValue, ((userPasskey >> passkeyBitCounter) & 1) | 0x80);
		}
		sendPacket(Buffer.concat([Buffer.from([SMP_PAIRING_CONFIRM]), rspConfirmValue]), SMP_PAIRING_RANDOM);
	}
	
	function afterNumericComparisonOkAndDHKeyCheck() {
		var res = generateLtkEaEb(peerPublicKey, ia, iat, ra, rat, initRandomValue, rspRandomValue, userPasskey, pairingFeatures.maxKeySize, pairingRequestData.slice(1, 4), pairingResponseData.slice(1, 4));
		if (!res) {
			pairingFailed(SmpErrors.INVALID_PARAMETERS);
			return;
		}
		if (!timingSafeEqual(res.Ea, peerDHKeyCheck)) {
			pairingFailed(SmpErrors.DHKEY_CHECK_FAILED);
			return;
		}
		
		generatedLtk = res.ltk;
		sendPacket(Buffer.concat([Buffer.from([SMP_DHKEY_CHECK]), res.Eb]), null, function() {
			state = STATE_W4_LTK_REQUEST;
		});
	}
	
	registerOnDataFn(data => {
		if (data.length == 0 || state == STATE_TIMEDOUT) {
			// Just ignore
			return;
		}
		var opcode = data[0];
		if (opcode == 0x00 || opcode >= 0x0f) {
			// Ignore RFU opcodes as mandated by the specification
			return;
		}
		switch (opcode) {
			case SMP_PAIRING_REQUEST:
				if (state != STATE_IDLE && !(state == STATE_W4_PACKET && packetWaitOpcode == SMP_PAIRING_REQUEST)) {
					return;
				}
				if (data.length != 7) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				var req = parsePairingReqRsp(data, true);
				if (req.maxKeySize < 7 || req.maxKeySize > 16) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				pairingRequestData = data;
				restartTimeout();
				onPairingRequest(req);
				return;
			case SMP_PAIRING_PUBLIC_KEY:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_PAIRING_PUBLIC_KEY) {
					return;
				}
				if (data.length != 65) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				peerPublicKey = {x: data.slice(1, 33), y: data.slice(33, 65)};
				var rsp = Buffer.alloc(65);
				rsp[0] = SMP_PAIRING_PUBLIC_KEY;
				myEcdhPubKey.x.copy(rsp, 1);
				myEcdhPubKey.y.copy(rsp, 33);
				if (associationModel == ASSOCIATION_MODEL_JUST_WORKS || associationModel == ASSOCIATION_MODEL_NUMERIC_COMPARISON) {
					sendDataFn(rsp);
					rspRandomValue = crypto.randomBytes(16);
					sendPacket(Buffer.concat([Buffer.from([SMP_PAIRING_CONFIRM]), Toolbox.f4(myEcdhPubKey.x, peerPublicKey.x, rspRandomValue, 0)]), SMP_PAIRING_RANDOM);
				} else {
					sendPacket(rsp, SMP_PAIRING_CONFIRM);
				}
			case SMP_PAIRING_CONFIRM:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_PAIRING_CONFIRM) {
					return;
				}
				if (data.length != 17) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				initConfirmValue = data.slice(1);
				if (userPasskey != null) {
					afterInitsConfirmAndPasskey();
				} else {
					state = STATE_W4_USER_PASSKEY;
				}
				return;
			case SMP_PAIRING_RANDOM:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_PAIRING_RANDOM) {
					return;
				}
				if (data.length != 17) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				initRandomValue = data.slice(1);
				if (!pairingFeatures.sc) {
					var confirmTest = Toolbox.c1(passkeyToTk(userPasskey), initRandomValue, pairingResponseData, pairingRequestData, iat, ia, rat, ra);
					if (!timingSafeEqual(initConfirmValue, confirmTest)) {
						pairingFailed(SmpErrors.CONFIRM_VALUE_FAILED);
					} else {
						sendPacket(Buffer.concat([Buffer.from([SMP_PAIRING_RANDOM]), rspRandomValue]), null, function() {
							state = STATE_W4_LTK_REQUEST;
						});
					}
				} else {
					if (associationModel == ASSOCIATION_MODEL_JUST_WORKS || associationModel == ASSOCIATION_MODEL_NUMERIC_COMPARISON) {
						numericComparisonOk = false;
						sendPacket(Buffer.concat([Buffer.from([SMP_PAIRING_RANDOM]), rspRandomValue]), SMP_DHKEY_CHECK);
						if (associationModel == ASSOCIATION_MODEL_NUMERIC_COMPARISON) {
							var comparisonValue = Toolbox.g2(peerPublicKey.x, myEcdhPubKey.x, initRandomValue, rspRandomValue) % 1000000;
							var thisRunCounter = runCounter;
							smp.emit('passkeyExchange', associationModel, ("00000" + comparisonValue).substr(-6), function() {
								if (runCounter != thisRunCounter) {
									return;
								}
								numericComparisonOk = true;
								if (state == STATE_W4_USER_NUMERIC_COMPARISON) {
									afterNumericComparisonOkAndDHKeyCheck();
								}
							});
						}
					} else {
						// Passkey entry
						var confirmTest = Toolbox.f4(peerPublicKey.x, myEcdhPubKey.x, initRandomValue, ((userPasskey >> passkeyBitCounter) & 1) | 0x80);
						if (!timingSafeEqual(initConfirmValue, confirmTest)) {
							pairingFailed(SmpErrors.CONFIRM_VALUE_FAILED);
						} else {
							sendPacket(Buffer.concat([Buffer.concat([SMP_PAIRING_RANDOM]), rspRandomValue]), ++passkeyBitCounter < 20 ? SMP_PAIRING_CONFIRM : SMP_DHKEY_CHECK);
						}
					}
				}
				return;
			case SMP_DHKEY_CHECK:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_DHKEY_CHECK) {
					return;
				}
				if (data.length != 17) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				peerDHKeyCheck = data.slice(1);
				if (associationModel != ASSOCIATION_MODEL_NUMERIC_COMPARISON || numericComparisonOk) {
					afterNumericComparisonOkAndDHKeyCheck();
				} else {
					state = STATE_W4_USER_NUMERIC_COMPARISON;
				}
				return;
			case SMP_ENCRYPTION_INFORMATION:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_ENCRYPTION_INFORMATION) {
					return;
				}
				if (data.length != 17) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				initLtk = data.slice(1);
				packetWaitOpcode = SMP_MASTER_IDENTIFICATION;
				return;
			case SMP_MASTER_IDENTIFICATION:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_MASTER_IDENTIFICATION) {
					return;
				}
				if (data.length != 11) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				initEdivRand = data.slice(1);
				if (pairingFeatures.initKeyDistr.idKey) {
					packetWaitOpcode = SMP_IDENTITY_INFORMATION;
				} else {
					pairingDone();
				}
				return;
			case SMP_IDENTITY_INFORMATION:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_IDENTITY_INFORMATION) {
					return;
				}
				if (data.length != 17) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				initIrk = data.slice(1);
				packetWaitOpcode = SMP_IDENTITY_ADDRESS_INFORMATION;
				return;
			case SMP_IDENTITY_ADDRESS_INFORMATION:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_IDENTITY_ADDRESS_INFORMATION) {
					return;
				}
				if (data.length != 8) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				initIdentityAddressInformation = {addressType: data[1] ? "random" : "public", address: bufferToBdAddr(data.slice(2))};
				pairingDone();
				return;
			case SMP_KEYPRESS_NOTIFICATION:
				if (passkeyBitCounter != 0) {
					return;
				}
				if (!((packetWaitOpcode == SMP_PAIRING_CONFIRM && (state == STATE_W4_PACKET || state == STATE_W4_PACKET_ENQUEUED)) || (packetWaitOpcode == SMP_PAIRING_PUBLIC_KEY && state == STATE_W4_PACKET))) {
					return;
				}
				if (data.length != 2) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				if (!pairingFeatures.keypress || initIoCap != IO_CAP_KEYBOARD_ONLY || associationModel == ASSOCIATION_MODEL_JUST_WORKS) {
					return;
				}
				var notificationType = data[1];
				smp.emit('keypress', notificationType);
				return;
			case SMP_PAIRING_FAILED:
				if (data.length != 2) {
					// Don't send pairing failed with invalid parameters upon receiving pairing failed.
					return;
				}
				var reason = data[1];
				
				timeoutClearFn();
				state = STATE_IDLE;
				runCounter = idGenerator.next();
				
				smp.emit('pairingFail', reason, true);
				return;
		}
		pairingFailed(SmpErrors.COMMAND_NOT_SUPPORTED);
	});

	registerLtkRequestFn((randNb, ediv, ltkReplyCallback) => {
		if (state == STATE_W4_LTK_REQUEST && Buffer.alloc(8).equals(randNb) && ediv == 0x0000) {
			state = STATE_W4_ENCRYPTION_STARTED;
			var stk = pairingFeatures.sc ? generatedLtk : Toolbox.s1(passkeyToTk(userPasskey), rspRandomValue, initRandomValue).slice(0, pairingFeatures.maxKeySize);
			ltkReplyCallback(padKey(stk), () => {
				if (state == STATE_W4_ENCRYPTION_STARTED) {
					var packets = [];
					if (!pairingFeatures.sc && pairingFeatures.rspKeyDistr.encKey) {
						var randomBytes = crypto.randomBytes(26);
						for (var i = pairingFeatures.maxKeySize; i < 16; i++) {
							randomBytes[i] = 0;
						}
						rspLtk = randomBytes.slice(0, 16);
						rspEdivRand = randomBytes.slice(16);
						var encryptionInformation = Buffer.concat([Buffer.from([SMP_ENCRYPTION_INFORMATION]), rspLtk]);
						var masterIdentification = Buffer.concat([Buffer.from([SMP_MASTER_IDENTIFICATION]), rspEdivRand]);
						packets.push(encryptionInformation);
						packets.push(masterIdentification);
					}
					if (pairingFeatures.rspKeyDistr.idKey) {
						var irk = Buffer.alloc(17);
						irk[0] = SMP_IDENTITY_INFORMATION;
						// We don't have an IRK, so set all bytes to zero, per the specification
						var identityAddressInformation = Buffer.alloc(8);
						identityAddressInformation[0] = SMP_IDENTITY_ADDRESS_INFORMATION;
						identityAddressInformation[1] = rat;
						ra.copy(identityAddressInformation, 2);
						packets.push(irk);
						packets.push(identityAddressInformation);
					}
					for (var i = 0; i < packets.length - 1; i++) {
						restartTimeout();
						sendDataFn(packets[i]);
					}
					if ((!pairingFeatures.sc && pairingFeatures.initKeyDistr.encKey) || pairingFeatures.initKeyDistr.idKey) {
						var nextPacketToReceive = !pairingFeatures.sc && pairingFeatures.initKeyDistr.encKey ? SMP_ENCRYPTION_INFORMATION : SMP_IDENTITY_INFORMATION;
						if (packets.length != 0) {
							sendPacket(packets[packets.length - 1], nextPacketToReceive);
						} else {
							state = STATE_W4_PACKET;
							packetWaitOpcode = nextPacketToReceive;
						}
					} else {
						if (packets.length != 0) {
							state = STATE_W4_LAST_ACK;
							var thisRunCounter = runCounter;
							restartTimeout();
							sendDataFn(packets[packets.length - 1], null, function() {
								if (runCounter != thisRunCounter) {
									return;
								}
								pairingDone();
							});
						} else {
							isEncrypted = true;
							smp.emit('encrypt', 0, currentEncryptionLevel = Object.freeze({mitm: pairingFeatures.mitm, sc: pairingFeatures.sc, keySize: pairingFeatures.maxKeySize}));
							if (state == STATE_W4_ENCRYPTION_STARTED) {
								// Don't know the best way to handle if the user calls sendPairingFailed during the handling of the 'encrypted' event,
								// but for now ignore to complete the pairing.
								pairingDone();
							}
							return;
						}
					}
				}
				isEncrypted = true;
				smp.emit('encrypt', 0, currentEncryptionLevel = Object.freeze({mitm: pairingFeatures.mitm, sc: pairingFeatures.sc, keySize: pairingFeatures.maxKeySize}));
			});
		} else {
			var clearState = false;
			if (state == STATE_W4_PACKET && packetWaitOpcode == SMP_PAIRING_REQUEST) {
				// Security request sent, but instead of pairing the master encrypts directly.
				// It's a bug in the spec that it only says to clear the timer upon pairing complete in my opinion.
				timeoutClearFn();
				clearState = true;
			}
			
			var ltk = availableLtk;
			if (ltk && randNb.equals(ltk.rand) && ediv == ltk.ediv) {
				ltkReplyCallback(padKey(ltk.ltk), () => {
					isEncrypted = true;
					if (clearState) {
						state = STATE_IDLE;
					}
					smp.emit('encrypt', 0, currentEncryptionLevel = Object.freeze({mitm: ltk.mitm, sc: ltk.mitm, keySize: ltk.length}));
				});
			} else {
				ltkReplyCallback(null, () => {
					if (clearState) {
						state = STATE_IDLE;
					}
					smp.emit('encrypt', Errors.HCI_PIN_OR_KEY_MISSING);
				});
			}
		}
	});
	
	this.setAvailableLtk = function(ltk, rand, ediv, mitm, sc) {
		if (!(ltk instanceof Buffer) || ltk.length < 7 || ltk.length > 16) {
			throw new Error('Invalid ltk');
		}
		if (!(rand instanceof Buffer) || rand.length != 8) {
			throw new Error('Invalid rand');
		}
		if (!Number.isInteger(ediv) || ediv < 0 || ediv > 0xffff) {
			throw new Error('Invalid ediv');
		}
		if (typeof mitm !== 'boolean') {
			throw new Error('Invalid mitm');
		}
		if (typeof sc !== 'boolean') {
			throw new Error('Invalid sc');
		}
		availableLtk = {ltk: Buffer.from(ltk), rand: Buffer.from(rand), ediv: ediv, mitm: mitm, sc: sc};
	};
	
	this.sendSecurityRequest = function(bond, mitm, keypress) {
		// TODO: shall not issue the request between ltk request has been received and encryption is complete/rejected
		// but shouldn't really matter because the controller pauses packets in the meantime anyway
		
		var authReq = (bond ? 1 : 0) | (mitm ? 4 : 0) | (SC_IS_SUPPORTED ? 8 : 0) | (keypress ? 16 : 0);
		
		if (state == STATE_IDLE) {
			state = STATE_W4_PACKET;
			packetWaitOpcode = SMP_PAIRING_REQUEST;
			restartTimeout();
			sendDataFn(Buffer.from([SMP_SECURITY_REQUEST, authReq]));
		}
	};
	
	this.sendPairingFailed = function(reason) {
		if (state != STATE_IDLE && state != STATE_TIMEDOUT) {
			pairingFailed(reason);
		}
	};
	
	this.sendKeypressNotification = function(notificationType) {
		if (!Number.isInteger(notificationType) || notificationType < 0 || notificationType > 5) {
			throw new Error("Invalid notificationType. Needs to be an integer between 0 and 4.");
		}
		if (pairingFeatures.ioCap != IO_CAP_KEYBOARD_ONLY || !pairingFeatures.keypress || associationModel == ASSOCIATION_MODEL_JUST_WORKS) {
			return;
		}
		if (passkeyBitCounter != 0) {
			return;
		}
		if (!(((state == STATE_W4_PACKET || state == STATE_W4_PACKET_ENQUEUED) && packetWaitOpcode == SMP_PAIRING_CONFIRM) || (state == STATE_W4_PACKET && packetWaitOpcode == SMP_PAIRING_PUBLIC_KEY) || state == STATE_W4_USER_PASSKEY)) {
			return;
		}
		
		// It's pretty stupid to reset the timeout since master does not reset when a notification arrives,
		// which leads to slave times out much later than master if the user is slow at entering the passkey.
		// However the spec requires that the timer is reset on ALL SMP commands (except security request and pairing request) and keypress notification is not an exception.
		restartTimeout();
		
		sendDataFn(Buffer.from([SMP_KEYPRESS_NOTIFICATION, notificationType]));
	};
	
	Object.defineProperty(this, 'isEncrypted', {enumerable: true, configurable: false, get: () => isEncrypted});
	Object.defineProperty(this, 'currentEncryptionLevel', {enumerable: true, configurable: false, get: () => currentEncryptionLevel});
	Object.defineProperty(this, 'isBonded', {enumerable: true, configurable: false, get: () => isBonded});
	Object.defineProperty(this, 'hasLtk', {enumerable: true, configurable: false, get: () => availableLtk != null});
}
util.inherits(SmpSlaveConnection, EventEmitter);

function SmpMasterConnection(connection, registerOnDataFn, sendDataFn, startEncryptionFn, updateIdentityAddressFn, bondDoneFn) {
	EventEmitter.call(this);
	var smp = this;
	
	var idGenerator = new utils.IdGenerator();
	
	var iat = connection.ownAddressType == 'random' ? 0x01 : 0x00;
	var ia = bdAddrToBuffer(connection.ownAddress);
	var rat = connection.peerAddressType == 'random' ? 0x01 : 0x00;
	var ra = bdAddrToBuffer(connection.peerAddress);
	
	var isEncrypted = false;
	var currentEncryptionLevel = null;
	
	var state = STATE_IDLE;
	var packetWaitOpcode;
	var availableLtk = null;
	var isBonded = false;
	var encryptionProcessWithLtk = false;
	var timeoutClearFn = function() {};
	var runCounter = idGenerator.next();
	
	var userHandledRequest;
	
	var pairingRequestData;
	var pairingResponseData;
	var pairingFeatures;
	var associationModel;
	var initIoCap;
	var rspIoCap;
	
	var peerPublicKey;
	var userPasskey;
	var passkeyBitCounter;
	var rspConfirmValue;
	var initRandomValue;
	var rspRandomValue;
	var expectedEb;
	
	var generatedLtk;
	var rspLtk;
	var rspEdivRand;
	var initLtk;
	var initEdivRand;
	var rspIrk;
	var rspIdentityAddressInformation;
	
	var savedPairingFailedReason;
	
	function getAddressesForStorage() {
		var ownAddress = storage.constructAddress(connection.ownAddressType, connection.ownAddress);
		var peerAddress = connection.peerIdentityAddress ?
			storage.constructAddress(connection.peerIdentityAddressType, connection.peerIdentityAddress) :
			storage.constructAddress(connection.peerAddressType, connection.peerAddress);
		return [ownAddress, peerAddress];
	}
	
	(function() {
		var a = getAddressesForStorage();
		var keys = storage.getKeys(a[0], a[1]);
		if (keys) {
			var ltk = keys.peerLtk;
			if (ltk) {
				availableLtk = {ltk: ltk.ltk, rand: ltk.rand, ediv: ltk.ediv, mitm: keys.mitm, sc: keys.sc};
				isBonded = true;
			}
		}
		//console.log("IS BONDED: " + isBonded);
	})();
	
	var hasOutgoingFailedMsg = false;
	function pairingFailed(reason, isErrorFromRemote) {
		timeoutClearFn();
		if (!hasOutgoingFailedMsg && !isErrorFromRemote) {
			hasOutgoingFailedMsg = true;
			sendDataFn(Buffer.from([SMP_PAIRING_FAILED, reason]), function() {
				hasOutgoingFailedMsg = false;
			});
		}
		state = STATE_IDLE;
		runCounter = idGenerator.next();
		
		if (!encryptionProcessWithLtk) {
			smp.emit('pairingFail', reason, !!isErrorFromRemote);
		}
	}
	
	function pairingDone() {
		timeoutClearFn();
		state = STATE_IDLE;
		runCounter = idGenerator.next();
		var sc = pairingFeatures.sc;
		var res = {
			sc: sc,
			mitm: pairingFeatures.mitm && associationModel != ASSOCIATION_MODEL_JUST_WORKS,
			bond: pairingFeatures.bondingFlags != 0,
			rspEdiv: sc ? 0x0000 : rspEdivRand ? rspEdivRand.readUInt16LE(0) : null,
			rspRand: sc ? Buffer.alloc(8) : rspEdivRand ? rspEdivRand.slice(2) : null,
			rspLtk: sc ? generatedLtk : rspLtk,
			initEdiv: sc ? 0x0000 : initEdivRand ? initEdivRand.readUInt16LE(0) : null,
			initRand: sc ? Buffer.alloc(8) : initEdivRand ? initEdivRand.slice(2) : null,
			initLtk: sc ? generatedLtk : initLtk,
			rspIrk: rspIrk,
			rspIdentityAddress: rspIdentityAddressInformation
		};
		if (res.rspIdentityAddress && res.rspIdentityAddress.address != '00:00:00:00:00:00') {
			updateIdentityAddressFn(res.rspIdentityAddress.addressType, res.rspIdentityAddress.address);
		}
		if (res.bond) {
			var a = getAddressesForStorage();
			storage.storeKeys(a[0], a[1], res.mitm, res.sc, res.rspIrk, res.initLtk, res.initRand, res.initEdiv, res.rspLtk, res.rspRand, res.rspEdiv);
			isBonded = true;
			bondDoneFn();
		}
		if (res.bond && res.rspLtk) {
			availableLtk = {ltk: Buffer.from(res.rspLtk), rand: Buffer.from(res.rspRand), ediv: res.rspEdiv, mitm: res.mitm, sc: res.sc};
		}
		smp.emit('pairingComplete', res);
	}
	
	function restartTimeout() {
		timeoutClearFn();
		timeoutClearFn = connection.setTimeout(function() {
			runCounter = idGenerator.next();
			state = STATE_TIMEDOUT;
			sendDataFn = function() {};
			if (smp.listenerCount('timeout') > 0) {
				smp.emit('timeout');
			} else {
				connection.disconnect();
			}
		}, 30000);
	}
	
	function sendPacket(data, nextPacketOpcode, callback) {
		if (state == STATE_TIMEDOUT) {
			return;
		}
		restartTimeout();
		state = STATE_W4_PACKET_ENQUEUED;
		if (!callback) {
			packetWaitOpcode = nextPacketOpcode;
		}
		var thisRunCounter = runCounter;
		sendDataFn(data, function() {
			if (runCounter != thisRunCounter) {
				return;
			}
			if (callback) {
				callback();
			} else {
				state = STATE_W4_PACKET;
			}
		});
	}
	
	function askStartPairing(bondingFlags, mitm, sc, keypress) {
		var secReq = Object.freeze({bondingFlags: bondingFlags, mitm: mitm, sc: sc, keypress: keypress});
		restartTimeout();
		state = STATE_W4_USER_FEATURES;
		var thisRunCounter = runCounter;
		if (smp.listenerCount('pairingRequest') > 0) {
			userHandledRequest = true;
			smp.emit('pairingRequest', secReq, cont);
		} else {
			// If already bonded and unencrypted, disallow just works pairing here (this is also done again later when association model is really negotiated)
			if (isBonded) {
				if (!mitm && !isEncrypted) {
					pairingFailed(SmpErrors.AUTHENTICATION_REQUIREMENTS);
					return;
				}
				userHandledRequest = false;
			}
			cont(null);
		}
		function cont(req) {
			if (state != STATE_W4_USER_FEATURES || runCounter != thisRunCounter) {
				return;
			}
			startPairingRequest(req);
		}
	}
	
	function startPairingRequest(req) {
		req = fixFeaturesFromUser(req);
		
		// We request bonding only if at least one key is to be distributed / generated
		req.bondingFlags &= req.initKeyDistr.encKey || req.initKeyDistr.idKey || req.rspKeyDistr.encKey || req.rspKeyDistr.idKey || SC_IS_SUPPORTED;
		
		pairingRequestData = buildPairingFeaturesPacket(SMP_PAIRING_REQUEST, req);
		sendPacket(pairingRequestData, SMP_PAIRING_RESPONSE);
	}
	
	function onPairingResponse() {
		var req = parsePairingReqRsp(pairingRequestData, false);
		var rsp = parsePairingReqRsp(pairingResponseData, false);
		if (rsp.maxKeySize < 7 || rsp.maxKeySize > 16) {
			pairingFailed(SmpErrors.INVALID_PARAMETERS);
			return;
		}
		bitwiseAndKeys(rsp, req);
		pairingFeatures = rsp;
		combineAuthReq(pairingFeatures, req);
		associationModel = getAssociationModel(req.ioCap, rsp.ioCap, pairingFeatures.sc, pairingFeatures.mitm);
		initIoCap = req.ioCap;
		rspIoCap = rsp.ioCap;
		
		if (!userHandledRequest && isBonded && !isEncrypted && associationModel == ASSOCIATION_MODEL_JUST_WORKS) {
			pairingFailed(SmpErrors.AUTHENTICATION_REQUIREMENTS);
			return;
		}
		
		if (associationModel == ASSOCIATION_MODEL_PASSKEY_ENTRY_RSP_INPUTS) {
			userPasskey = crypto.randomBytes(4).readUInt32LE(0) % 1000000
		} else if (associationModel == ASSOCIATION_MODEL_JUST_WORKS || associationModel == ASSOCIATION_MODEL_NUMERIC_COMPARISON) {
			userPasskey = 0;
		} else {
			userPasskey = null;
		}
		
		rspLtk = null;
		rspEdivRand = null;
		initLtk = null;
		initEdivRand = null;
		rspIrk = null;
		rspIdentityAddressInformation = null;
		passkeyBitCounter = 0;
		
		if (pairingFeatures.sc) {
			var p = Buffer.alloc(65);
			p[0] = SMP_PAIRING_PUBLIC_KEY;
			myEcdhPubKey.x.copy(p, 1);
			myEcdhPubKey.y.copy(p, 33);
			sendPacket(p, SMP_PAIRING_PUBLIC_KEY);
		} else {
			startPasskeyExchange();
		}
	}
	
	function startPasskeyExchange() {
		if (associationModel != ASSOCIATION_MODEL_JUST_WORKS && associationModel != ASSOCIATION_MODEL_NUMERIC_COMPARISON) {
			state = STATE_W4_USER_PASSKEY;
			var thisRunCounter = runCounter;
			var ignore = associationModel == ASSOCIATION_MODEL_PASSKEY_ENTRY_RSP_INPUTS;
			smp.emit('passkeyExchange', associationModel, userPasskey == null ? null : ("00000" + userPasskey).substr(-6), function(passkeyResponse) {
				if (ignore) {
					return;
				}
				if (typeof passkeyResponse === 'string' && /^\d{1,6}$/.test(passkeyResponse)) {
					passkeyResponse = passkeyResponse | 0;
				}
				if (!(Number.isInteger(passkeyResponse) && passkeyResponse >= 0 && passkeyResponse <= 999999)) {
					throw new Error('Invalid passkey format');
				}
				if (state != STATE_W4_USER_PASSKEY || runCounter != thisRunCounter) {
					return;
				}
				if (userPasskey == null) {
					userPasskey = passkeyResponse;
					sendConfirm();
				}
			});
			if (ignore) {
				sendConfirm();
			}
		} else if (pairingFeatures.sc) {
			// Just works or numeric comparison
			initRandomValue = crypto.randomBytes(16);
			state = STATE_W4_PACKET;
			packetWaitOpcode = SMP_PAIRING_CONFIRM;
		} else {
			sendConfirm();
		}
	}
	
	function sendConfirm() {
		initRandomValue = crypto.randomBytes(16);
		var initConfirmValue;
		if (!pairingFeatures.sc) {
			initConfirmValue = Toolbox.c1(passkeyToTk(userPasskey), initRandomValue, pairingResponseData, pairingRequestData, iat, ia, rat, ra);
		} else {
			initConfirmValue = Toolbox.f4(myEcdhPubKey.x, peerPublicKey.x, initRandomValue, ((userPasskey >> passkeyBitCounter) & 1) | 0x80);
		}
		sendPacket(Buffer.concat([Buffer.from([SMP_PAIRING_CONFIRM]), initConfirmValue]), SMP_PAIRING_CONFIRM);
	}
	
	function onPairingRandom() {
		if (pairingFeatures.sc) {
			var usePasskey = associationModel != ASSOCIATION_MODEL_JUST_WORKS && associationModel != ASSOCIATION_MODEL_NUMERIC_COMPARISON;
			var Z = usePasskey ? (((userPasskey >> passkeyBitCounter) & 1) | 0x80) : 0;
			if (!timingSafeEqual(rspConfirmValue, Toolbox.f4(peerPublicKey.x, myEcdhPubKey.x, rspRandomValue, Z))) {
				pairingFailed(SmpErrors.CONFIRM_VALUE_FAILED);
				return;
			}
			
			if (associationModel == ASSOCIATION_MODEL_JUST_WORKS) {
				sendDHKeyCheck();
			} else if (associationModel == ASSOCIATION_MODEL_NUMERIC_COMPARISON) {
				var comparisonValue = Toolbox.g2(myEcdhPubKey.x, peerPublicKey.x, initRandomValue, rspRandomValue) % 1000000;
				var thisRunCounter = runCounter;
				state = STATE_W4_USER_NUMERIC_COMPARISON;
				smp.emit('passkeyExchange', associationModel, ("00000" + comparisonValue).substr(-6), function() {
					if (state != STATE_W4_USER_NUMERIC_COMPARISON || runCounter != thisRunCounter) {
						return;
					}
					sendDHKeyCheck();
				});
			} else {
				if (++passkeyBitCounter < 20) {
					sendConfirm();
				} else {
					sendDHKeyCheck();
				}
			}
		} else {
			if (!timingSafeEqual(rspConfirmValue, Toolbox.c1(passkeyToTk(userPasskey), rspRandomValue, pairingResponseData, pairingRequestData, iat, ia, rat, ra))) {
				pairingFailed(SmpErrors.CONFIRM_VALUE_FAILED);
				return;
			}
			startEncryptionAfterPairing();
		}
		
		function sendDHKeyCheck() {
			var res = generateLtkEaEb(peerPublicKey, ia, iat, ra, rat, initRandomValue, rspRandomValue, userPasskey, pairingFeatures.maxKeySize, pairingRequestData.slice(1, 4), pairingResponseData.slice(1, 4));
			if (!res) {
				pairingFailed(SmpErrors.INVALID_PARAMETERS);
				return;
			}
			expectedEb = res.Eb;
			generatedLtk = res.ltk;
			sendPacket(Buffer.concat([Buffer.from([SMP_DHKEY_CHECK]), res.Ea]), SMP_DHKEY_CHECK);
		}
	}
	
	function onDHKeyCheck(Eb) {
		if (!timingSafeEqual(Eb, expectedEb)) {
			pairingFailed(SmpErrors.DHKEY_CHECK_FAILED);
			return;
		}
		startEncryptionAfterPairing();
	}
	
	function startEncryptionAfterPairing() {
		var stk = pairingFeatures.sc ? generatedLtk : Toolbox.s1(passkeyToTk(userPasskey), rspRandomValue, initRandomValue).slice(0, pairingFeatures.maxKeySize);
		state = STATE_W4_ENCRYPTION_STARTED;
		startEncryptionFn(Buffer.alloc(8), 0x0000, padKey(stk), (status, on) => {
			var success = status == 0 && on;
			var negativeReply = status == Errors.HCI_PIN_OR_KEY_MISSING || (status == 0 && !on); // Don't know if any controllers sends off with ok status
			var unsupported = status == Errors.HCI_UNSUPPORTED_REMOTE_FEATURE;
			var failure = !success && !negativeReply && !unsupported;
			
			if (isEncrypted && !success) {
				// If re-encryption is requested, the slave must either give a valid key or terminate.
				// Block incoming traffic so unencrypted packets aren't processed.
				connection.disconnect(Errors.HCI_OE_USER_ENDED_CONNECTION, true);
				state = STATE_TIMEDOUT; // To disallow new requests
				return;
			}
			if (success) {
				isEncrypted = true;
				smp.emit('encrypt', status, currentEncryptionLevel = Object.freeze({mitm: pairingFeatures.mitm, sc: pairingFeatures.sc, keySize: pairingFeatures.maxKeySize}));
			}
			
			if (state == STATE_W4_ENCRYPTION_STARTED) {
				if (!success) {
					// Happens for example, if slave's host cancels pairing at the moment the slave's controller receives the LL_ENC_REQ,
					// then it might not have the TK anymore when slave's host receives the key request.
					// To make it easy, we fail the pairing before waiting for a possible pairing failed from slave.
					pairingFailed(SmpErrors.UNSPECIFIED_REASON);
					return;
				}
				if (!pairingFeatures.sc && pairingFeatures.rspKeyDistr.encKey) {
					state = STATE_W4_PACKET;
					packetWaitOpcode = SMP_ENCRYPTION_INFORMATION;
				} else if (pairingFeatures.rspKeyDistr.idKey) {
					state = STATE_W4_PACKET;
					packetWaitOpcode = SMP_IDENTITY_INFORMATION;
				} else {
					startDistributeOwnKeys();
				}
			} else {
				// If slave sent Pairing Failed before master's controller received the start encryption command,
				// or if master's host cancelled pairing while the encryption procedure was in progress (or while the user was handling the 'encrypted' event).
				
				if (state == STATE_CANCELLED_BY_LOCAL_AND_W4_ENCRYPTION_STARTED) {
					pairingFailed(savedPairingFailedReason);
				} else if (state == STATE_CANCELLED_BY_PEER_AND_W4_ENCRYPTION_STARTED) {
					pairingFailed(savedPairingFailedReason, true);
				} else {
					assert(state == STATE_TIMEDOUT);
				}
			}
		});
	}
	
	function startDistributeOwnKeys() {
		var packets = [];
		if (!pairingFeatures.sc && pairingFeatures.initKeyDistr.encKey) {
			var randomBytes = crypto.randomBytes(26);
			for (var i = pairingFeatures.maxKeySize; i < 16; i++) {
				randomBytes[i] = 0;
			}
			initLtk = randomBytes.slice(0, 16);
			initEdivRand = randomBytes.slice(16);
			var encryptionInformation = Buffer.concat([Buffer.from([SMP_ENCRYPTION_INFORMATION]), initLtk]);
			var masterIdentification = Buffer.concat([Buffer.from([SMP_MASTER_IDENTIFICATION]), initEdivRand]);
			packets.push(encryptionInformation);
			packets.push(masterIdentification);
		}
		if (pairingFeatures.initKeyDistr.idKey) {
			var irk = Buffer.alloc(17);
			irk[0] = SMP_IDENTITY_INFORMATION;
			// We don't have an IRK, so set all bytes to zero, per the specification
			var identityAddressInformation = Buffer.alloc(8);
			identityAddressInformation[0] = SMP_IDENTITY_ADDRESS_INFORMATION;
			identityAddressInformation[1] = iat;
			ia.copy(identityAddressInformation, 2);
			packets.push(irk);
			packets.push(identityAddressInformation);
		}
		for (var i = 0; i < packets.length - 1; i++) {
			restartTimeout();
			sendDataFn(packets[i]);
		}
		if (packets.length != 0) {
			state = STATE_W4_LAST_ACK;
			var thisRunCounter = runCounter;
			restartTimeout();
			sendDataFn(packets[packets.length - 1], null, function() {
				if (runCounter != thisRunCounter) {
					return;
				}
				pairingDone();
			});
		} else {
			pairingDone();
		}
	}
	
	function onPairingFailed(reason) {
		if (state == STATE_W4_ENCRYPTION_STARTED && !encryptionProcessWithLtk) {
			state = STATE_CANCELLED_BY_PEER_AND_W4_ENCRYPTION_STARTED;
			savedPairingFailedReason = reason;
			return;
		}
		if (state == STATE_CANCELLED_BY_PEER_AND_W4_ENCRYPTION_STARTED || state == STATE_CANCELLED_BY_LOCAL_AND_W4_ENCRYPTION_STARTED) {
			// Already has saved pairing failed reason
			return;
		}
		
		pairingFailed(reason, true);
	}
	
	function sendPairingFailed(reason) {
		if (state == STATE_TIMEDOUT || state == STATE_CANCELLED_BY_PEER_AND_W4_ENCRYPTION_STARTED || state == STATE_CANCELLED_BY_LOCAL_AND_W4_ENCRYPTION_STARTED) {
			return;
		}
		if (state == STATE_W4_ENCRYPTION_STARTED && !encryptionProcessWithLtk) {
			state = STATE_CANCELLED_BY_LOCAL_AND_W4_ENCRYPTION_STARTED;
			savedPairingFailedReason = reason;
			return;
		}
		pairingFailed(reason);
	}
	
	function startEncryptWithAvailableLtk(isSecReq, bondingFlags, mitm, sc, keypress) {
		state = STATE_W4_ENCRYPTION_STARTED;
		encryptionProcessWithLtk = true;
		startEncryptionFn(availableLtk.rand, availableLtk.ediv, padKey(availableLtk.ltk), (status, on) => {
			encryptionProcessWithLtk = false;
			
			var success = status == 0 && on;
			var negativeReply = status == Errors.HCI_PIN_OR_KEY_MISSING || (status == 0 && !on); // Don't know if any controllers sends off with ok status
			var unsupported = status == Errors.HCI_UNSUPPORTED_REMOTE_FEATURE;
			var failure = !success && !negativeReply && !unsupported;
			
			if (isEncrypted && !success) {
				// If re-encryption is requested, the slave must either give a valid key or terminate.
				// Block incoming traffic so unencrypted packets aren't processed.
				connection.disconnect(Errors.HCI_OE_USER_ENDED_CONNECTION, true);
				state = STATE_TIMEDOUT; // To disallow new requests
				return;
			}
			if (success) {
				isEncrypted = true;
			}
			
			if (state != STATE_TIMEDOUT) {
				timeoutClearFn();
				runCounter = idGenerator.next();
				state = STATE_IDLE;
			}
			
			if (negativeReply) {
				if (isSecReq) {
					askStartPairing(bondingFlags, mitm, sc, keypress);
				} else {
					smp.emit('encrypt', Errors.HCI_PIN_OR_KEY_MISSING);
				}
			} else if (success) {
				smp.emit('encrypt', status, currentEncryptionLevel = Object.freeze({mitm: availableLtk.mitm, sc: availableLtk.sc, keySize: availableLtk.length}));
			} else {
				// Failure should only happen upon disconnection or if one of the controllers misbehaves.
				// Possibly unsupported status, but since we have encrypted before on this device, that's unlikely.
				smp.emit('encrypt', status);
			}
		});
	}
	
	registerOnDataFn(data => {
		if (data.length == 0 || state == STATE_TIMEDOUT) {
			// Just ignore
			return;
		}
		var opcode = data[0];
		if (opcode == 0x00 || opcode >= 0x0f) {
			// Ignore RFU opcodes as mandated by the specification
			return;
		}
		switch (opcode) {
			case SMP_SECURITY_REQUEST:
				if (state != STATE_IDLE) {
					// It seems the spec allows this packet if the master has received the pairing response, unless it has initiated encryption mode setup,
					// although it says the slave shouldn't send it while the pairing procedure is in progress.
					return;
				}
				if (data.length != 2) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				
				var bondingFlags = data[1] & 3;
				var mitm = (data[1] & 4) != 0;
				var sc = (data[1] & 8) != 0;
				var keypress = (data[1] & 16) != 0;
				if (availableLtk && availableLtk.ltk.length == 16 && availableLtk.mitm >= mitm && availableLtk.sc >= sc) {
					// Security properties are met, so start/refresh encryption
					startEncryptWithAvailableLtk(true, bondingFlags, mitm, sc, keypress);
				} else {
					askStartPairing(bondingFlags, mitm, sc, keypress);
				}
				return;
			case SMP_PAIRING_RESPONSE:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_PAIRING_RESPONSE) {
					return;
				}
				if (data.length != 7) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				pairingResponseData = data;
				onPairingResponse();
				return;
			case SMP_PAIRING_PUBLIC_KEY:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_PAIRING_PUBLIC_KEY) {
					return;
				}
				if (data.length != 65) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				peerPublicKey = {x: data.slice(1, 33), y: data.slice(33, 65)};
				startPasskeyExchange();
				return;
			case SMP_PAIRING_CONFIRM:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_PAIRING_CONFIRM) {
					return;
				}
				if (data.length != 17) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				rspConfirmValue = data.slice(1);
				sendPacket(Buffer.concat([Buffer.from([SMP_PAIRING_RANDOM]), initRandomValue]), SMP_PAIRING_RANDOM);
				return;
			case SMP_PAIRING_RANDOM:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_PAIRING_RANDOM) {
					return;
				}
				if (data.length != 17) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				rspRandomValue = data.slice(1);
				onPairingRandom();
				return;
			case SMP_DHKEY_CHECK:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_DHKEY_CHECK) {
					return;
				}
				if (data.length != 17) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				var Eb = data.slice(1);
				onDHKeyCheck(Eb);
				return;
			case SMP_ENCRYPTION_INFORMATION:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_ENCRYPTION_INFORMATION) {
					return;
				}
				if (data.length != 17) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				rspLtk = data.slice(1);
				packetWaitOpcode = SMP_MASTER_IDENTIFICATION;
				return;
			case SMP_MASTER_IDENTIFICATION:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_MASTER_IDENTIFICATION) {
					return;
				}
				if (data.length != 11) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				rspEdivRand = data.slice(1);
				if (pairingFeatures.rspKeyDistr.idKey) {
					packetWaitOpcode = SMP_IDENTITY_INFORMATION;
				} else {
					startDistributeOwnKeys();
				}
				return;
			case SMP_IDENTITY_INFORMATION:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_IDENTITY_INFORMATION) {
					return;
				}
				if (data.length != 17) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				rspIrk = data.slice(1);
				packetWaitOpcode = SMP_IDENTITY_ADDRESS_INFORMATION;
				return;
			case SMP_IDENTITY_ADDRESS_INFORMATION:
				if (state != STATE_W4_PACKET || packetWaitOpcode != SMP_IDENTITY_ADDRESS_INFORMATION) {
					return;
				}
				if (data.length != 8) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				rspIdentityAddressInformation = {addressType: data[1] ? "random" : "public", address: bufferToBdAddr(data.slice(2))};
				startDistributeOwnKeys();
				return;
			case SMP_KEYPRESS_NOTIFICATION:
				if (passkeyBitCounter != 0) {
					return;
				}
				if (!((state == STATE_W4_PACKET || state == STATE_W4_PACKET_ENQUEUED) && (packetWaitOpcode == SMP_PAIRING_PUBLIC_KEY || packetWaitOpcode == SMP_PAIRING_CONFIRM))) {
					return;
				}
				if (data.length != 2) {
					pairingFailed(SmpErrors.INVALID_PARAMETERS);
					return;
				}
				if (!pairingFeatures.keypress || rspIoCap != IO_CAP_KEYBOARD_ONLY || associationModel == ASSOCIATION_MODEL_JUST_WORKS) {
					return;
				}
				var notificationType = data[1];
				smp.emit('keypress', notificationType);
				return;
			case SMP_PAIRING_FAILED:
				if (data.length != 2) {
					// Don't send pairing failed with invalid parameters upon receiving pairing failed.
					return;
				}
				var reason = data[1];
				onPairingFailed(reason);
				return;
		}
		
		sendPairingFailed(SmpErrors.COMMAND_NOT_SUPPORTED);
	});
	
	this.setAvailableLtk = function(ltk, rand, ediv, mitm, sc) {
		if (!(ltk instanceof Buffer) || ltk.length < 7 || ltk.length > 16) {
			throw new Error('Invalid ltk');
		}
		if (!(rand instanceof Buffer) || rand.length != 8) {
			throw new Error('Invalid rand');
		}
		if (!Number.isInteger(ediv) || ediv < 0 || ediv > 0xffff) {
			throw new Error('Invalid ediv');
		}
		if (typeof mitm !== 'boolean') {
			throw new Error('Invalid mitm');
		}
		if (typeof sc !== 'boolean') {
			throw new Error('Invalid sc');
		}
		availableLtk = {ltk: Buffer.from(ltk), rand: Buffer.from(rand), ediv: ediv, mitm: mitm, sc: sc};
	};
	
	this.startEncryption = function() {
		if (!availableLtk) {
			throw new Error('LTK not available');
		}
		if (state != STATE_IDLE) {
			// User can wait for the 'encrypt' or 'pairingRequest' event if the user didn't initiate an earlier pairing process.
			// Otherwise 'pairingFail' or 'pairingComplete' event will be sent when complete.
			// FIXME: can't currently start encryption after timeout, which is technically not prohibited by the spec.
			return false;
		}
		startEncryptWithAvailableLtk(false);
		return true;
	};
	
	this.sendPairingRequest = function(req) {
		if (state != STATE_IDLE && state != STATE_W4_USER_FEATURES) {
			// User can wait for the 'encrypt' or 'pairingRequest' event if the user didn't initiate an earlier pairing process.
			// Otherwise 'pairingFail' or 'pairingComplete' event will be sent when complete.
			return false;
		}
		userHandledRequest = true;
		startPairingRequest(req);
		return true;
	};
	
	this.sendPairingFailed = function(reason) {
		if (state != STATE_IDLE && state != STATE_TIMEDOUT && !encryptionProcessWithLtk) {
			sendPairingFailed(reason);
		}
	};
	
	this.sendKeypressNotification = function(notificationType) {
		if (!Number.isInteger(notificationType) || notificationType < 0 || notificationType > 5) {
			throw new Error("Invalid notificationType. Needs to be an integer between 0 and 4.");
		}
		if (initIoCap != IO_CAP_KEYBOARD_ONLY || !pairingFeatures.keypress || associationModel == ASSOCIATION_MODEL_JUST_WORKS) {
			return;
		}
		if (state != STATE_W4_USER_PASSKEY) {
			return;
		}
		
		// It's pretty stupid to reset the timeout since slave does not reset when a notification arrives,
		// which leads to slave times out much later than slave if the user is slow at entering the passkey.
		// However the spec requires that the timer is reset on ALL SMP commands (except security request and pairing request) and keypress notification is not an exception.
		restartTimeout();
		
		sendDataFn(Buffer.from([SMP_KEYPRESS_NOTIFICATION, notificationType]));
	};
	
	Object.defineProperty(this, 'isEncrypted', {enumerable: true, configurable: false, get: () => isEncrypted});
	Object.defineProperty(this, 'currentEncryptionLevel', {enumerable: true, configurable: false, get: () => currentEncryptionLevel});
	Object.defineProperty(this, 'isBonded', {enumerable: true, configurable: false, get: () => isBonded});
	Object.defineProperty(this, 'hasLtk', {enumerable: true, configurable: false, get: () => availableLtk != null});
};
util.inherits(SmpMasterConnection, EventEmitter);

module.exports = {
	SmpSlaveConnection: SmpSlaveConnection,
	SmpMasterConnection: SmpMasterConnection
};
