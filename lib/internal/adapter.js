/*
 * Requirements for transport:
 * Needs write(Buffer) function
 * Needs 'data' event, where the only parameter of type Buffer is a complete HCI packet
 */

const EventEmitter = require('events');
const util = require('util');

const Errors = require('../errors');
const Queue = require('./utils').Queue;

const HCI_COMMAND_PKT = 0x01;
const HCI_ACLDATA_PKT = 0x02;
const HCI_EVENT_PKT = 0x04;

const EVT_DISCONNECTION_COMPLETE = 0x05;
const EVT_ENCRYPTION_CHANGE = 0x08;
const EVT_READ_REMOTE_VERSION_INFORMATION_COMPLETE = 0x0c;
const EVT_CMD_COMPLETE = 0x0e;
const EVT_CMD_STATUS = 0x0f;
const EVT_HARDWARE_ERROR = 0x10;
const EVT_NUMBER_OF_COMPLETE_PACKETS = 0x13;
const EVT_ENCRYPTION_KEY_REFRESH_COMPLETE = 0x30;
const EVT_LE_META = 0x3e;

const EVT_LE_CONNECTION_COMPLETE = 0x01;
const EVT_LE_ADVERTISING_REPORT = 0x02;
const EVT_LE_CONNECTION_UPDATE_COMPLETE = 0x03;
const EVT_LE_READ_REMOTE_USED_FEATURES_COMPLETE = 0x04;
const EVT_LE_LONG_TERM_KEY_REQUEST = 0x05;
const EVT_LE_READ_LOCAL_P256_PUBLIC_KEY_COMPLETE = 0x08;
const EVT_LE_GENERATE_DHKEY_COMPLETE = 0x09;
const EVT_LE_ENHANCED_CONNECTION_COMPLETE = 0x0a;
const EVT_LE_PHY_UPDATE_COMPLETE = 0x0c;
const EVT_LE_EXTENDED_ADVERTISING_REPORT = 0x0d;

const OGF_LINK_CTL = 0x01;
const OGF_HOST_CTL = 0x03;
const OGF_INFO_PARAM = 0x04;
const OGF_STATUS_PARAM = 0x05;
const OGF_LE_CTL = 0x08;

const DISCONNECT_CMD = 0x0006 | (OGF_LINK_CTL << 10);
const READ_REMOTE_VERSION_INFORMATION_CMD = 0x001d | (OGF_LINK_CTL << 10);

const SET_EVENT_MASK_CMD = 0x0001 | (OGF_HOST_CTL << 10);
const RESET_CMD = 0x0003 | (OGF_HOST_CTL << 10);

const READ_LOCAL_VERSION_INFORMATION_CMD = 0x0001 | (OGF_INFO_PARAM << 10);
const READ_BUFFER_SIZE_CMD = 0x0005 | (OGF_INFO_PARAM << 10);
const READ_BD_ADDR_CMD = 0x0009 | (OGF_INFO_PARAM << 10);

const READ_RSSI_CMD = 0x0005 | (OGF_STATUS_PARAM << 10);

const LE_SET_EVENT_MASK_CMD = 0x0001 | (OGF_LE_CTL << 10);
const LE_READ_BUFFER_SIZE_CMD = 0x0002 | (OGF_LE_CTL << 10);
const LE_READ_LOCAL_SUPPORTED_FEATURES_CMD = 0x0003 | (OGF_LE_CTL << 10);
const LE_SET_RANDOM_ADDRESS_CMD = 0x0005 | (OGF_LE_CTL << 10);
const LE_SET_ADVERTISING_PARAMETERS_CMD = 0x0006 | (OGF_LE_CTL << 10);
const LE_READ_ADVERTISING_CHANNEL_TX_POWER_CMD = 0x0007 | (OGF_LE_CTL << 10);
const LE_SET_ADVERTISING_DATA_CMD = 0x0008 | (OGF_LE_CTL << 10);
const LE_SET_SCAN_RESPONSE_DATA_CMD = 0x0009 | (OGF_LE_CTL << 10);
const LE_SET_ADVERTISING_ENABLE_CMD = 0x000a | (OGF_LE_CTL << 10);
const LE_SET_SCAN_PARAMETERS_CMD = 0x000b | (OGF_LE_CTL << 10);
const LE_SET_SCAN_ENABLE_CMD = 0x000c | (OGF_LE_CTL << 10);
const LE_CREATE_CONNECTION_CMD = 0x000d | (OGF_LE_CTL << 10);
const LE_CREATE_CONNECTION_CANCEL_CMD = 0x000e | (OGF_LE_CTL << 10);
const LE_READ_WHITE_LIST_SIZE_CMD = 0x000f | (OGF_LE_CTL << 10);
const LE_CLEAR_WHITE_LIST_CMD = 0x0010 | (OGF_LE_CTL << 10);
const LE_ADD_DEVICE_TO_WHITE_LIST_CMD = 0x0011 | (OGF_LE_CTL << 10);
const LE_REMOVE_DEVICE_FROM_WHITE_LIST_CMD = 0x0012 | (OGF_LE_CTL << 10);
const LE_CONNECTION_UPDATE_CMD = 0x0013 | (OGF_LE_CTL << 10);
const LE_READ_REMOTE_USED_FEATURES_CMD = 0x0016 | (OGF_LE_CTL << 10);
const LE_START_ENCRYPTION_CMD = 0x0019 | (OGF_LE_CTL << 10);
const LE_LONG_TERM_KEY_REQUEST_REPLY_CMD = 0x001a | (OGF_LE_CTL << 10);
const LE_LONG_TERM_KEY_REQUEST_NEGATIVE_REPLY_CMD = 0x001b | (OGF_LE_CTL << 10);
const LE_READ_SUPPORTED_STATES_CMD = 0x001c | (OGF_LE_CTL << 10);
const LE_SET_DATA_LENGTH_CMD = 0x0022 | (OGF_LE_CTL << 10);
const LE_READ_SUGGESTED_DEFAULT_DATA_LENGTH_CMD = 0x0023 | (OGF_LE_CTL << 10);
const LE_WRITE_SUGGESTED_DEFAULT_DATA_LENGTH_CMD = 0x0024 | (OGF_LE_CTL << 10);
const LE_READ_LOCAL_P256_PUBLIC_KEY_CMD = 0x0025 | (OGF_LE_CTL << 10);
const LE_GENERATE_DHKEY_CMD = 0x0026 | (OGF_LE_CTL << 10);
const LE_READ_MAXIMUM_DATA_LENGTH_CMD = 0x002F | (OGF_LE_CTL << 10);
const LE_SET_DEFAULT_PHY_CMD = 0x0031 | (OGF_LE_CTL << 10);
const LE_SET_PHY_CMD = 0x0032 | (OGF_LE_CTL << 10);
const LE_SET_EXTENDED_ADVERTISING_PARAMETERS_CMD = 0x0036 | (OGF_LE_CTL << 10);
const LE_SET_EXTENDED_ADVERTISING_ENABLE_CMD = 0x0039 | (OGF_LE_CTL << 10);
const LE_SET_EXTENDED_SCAN_PARAMETERS_CMD = 0x0041 | (OGF_LE_CTL << 10);
const LE_SET_EXTENDED_SCAN_ENABLE_CMD = 0x0042 | (OGF_LE_CTL << 10);
const LE_EXTENDED_CREATE_CONNECTION_CMD = 0x0043 | (OGF_LE_CTL << 10);

const ROLE_MASTER = 0x00;
const ROLE_SLAVE = 0x01;

const EMPTY_BUFFER = Buffer.from([]);

function isDisconnectErrorCode(c) {
	switch (c) {
		case Errors.HCI_CONNECTION_TIMEOUT:
		case Errors.HCI_OE_USER_ENDED_CONNECTION:
		case Errors.HCI_OE_LOW_RESOURCES:
		case Errors.HCI_OE_POWER_OFF:
		case Errors.HCI_CONNECTION_TERMINATED:
		case Errors.HCI_UNSUPPORTED_REMOTE_FEATURE:
		case Errors.HCI_LMP_RESPONSE_TIMEOUT:
		case Errors.HCI_INSTANT_PASSED:
		case Errors.HCI_UNACCEPTABLE_CONN_INTERV:
		case Errors.HCI_CONN_TERM_MIC_FAIL:
		case Errors.HCI_CONN_FAIL_TO_BE_ESTABL:
			return true;
	}
	return false;
}

function PacketWriter() {
	var buf = [];
	this.u8 = function(v) {
		buf.push(v);
		return this;
	};
	this.i8 = function(v) {
		buf.push(v);
		return this;
	};
	this.u16 = function(v) {
		buf.push(v & 0xff);
		buf.push((v >>> 8) & 0xff);
		return this;
	};
	this.u24 = function(v) {
		buf.push(v & 0xff);
		buf.push((v >>> 8) & 0xff);
		buf.push((v >>> 16) & 0xff);
		return this;
	};
	this.u32 = function(v) {
		buf.push(v & 0xff);
		buf.push((v >>> 8) & 0xff);
		buf.push((v >>> 16) & 0xff);
		buf.push((v >>> 24) & 0xff);
		return this;
	};
	this.bdAddr = function(v) {
		for (var i = 15; i >= 0; i -= 3) {
			buf.push(parseInt(v.substr(i, 2), 16));
		}
		return this;
	};
	this.buffer = function(v) {
		for (var i = 0; i < v.length; i++) {
			buf.push(v[i]);
		}
		return this;
	};
	this.toBuffer = function() {
		return Buffer.from(buf);
	};
}

function PacketReader(buffer, throwFn) {
	var pos = 0;
	this.u8 = function() {
		if (pos + 1 > buffer.length) {
			throwFn();
		}
		return buffer[pos++];
	};
	this.i8 = function() {
		var v = this.u8();
		return v >= 128 ? v - 256 : v;
	};
	this.u16 = function() {
		if (pos + 2 > buffer.length) {
			throwFn();
		}
		var v = buffer[pos] | (buffer[pos + 1] << 8);
		pos += 2;
		return v;
	};
	this.u32 = function() {
		if (pos + 4 > buffer.length) {
			throwFn();
		}
		var v = buffer[pos] | (buffer[pos + 1] << 8) | (buffer[pos + 2] << 16) | (buffer[pos + 3] << 24);
		pos += 4;
		return v;
	};
	this.bdAddr = function() {
		if (pos + 6 > buffer.length) {
			throwFn();
		}
		var str = '';
		for (var i = 5; i >= 0; i--) {
			str += (0x100 + buffer[pos + i]).toString(16).substr(-2).toUpperCase();
			if (i != 0) {
				str += ':';
			}
		}
		pos += 6;
		return str;
	};
	this.buffer = function(length) {
		if (pos + length > buffer.length) {
			throwFn();
		}
		var v = buffer.slice(pos, pos + length);
		pos += length;
		return v;
	};
	this.getRemainingBuffer = function() {
		return buffer.slice(pos);
	};
}

function HciAdapter(transport, hardwareErrorCallback) {
	var isStopped = false;
	var pendingCommand = null; // {opcode, callback, handle, ignoreResponse}
	var commandQueue = []; // {opcode, buffer, callback, handle}
	var activeConnections = Object.create(null); // {handle -> AclConnection}
	
	var hasSeparateLeAclBuffers = null;
	var aclMtu = 0;
	var numFreeBuffers = 0;
	
	var advCallback = null;
	var connCallback = null;
	var scanCallback = null;
	var leReadLocalP256PublicKeyCallback = null;
	var leGenerateDHKeyCallback = null;
	
	function AclConnection(handle, role) {
		EventEmitter.call(this);
		this.handle = handle;
		this.role = role;
		this.disconnecting = false;
		this.leConnectionUpdateCallback = null;
		this.leReadRemoteUsedFeaturesCallback = null;
		this.readRemoteVersionInformationCallback = null;
		this.encryptionChangeCallback = null;
		this.lePhyUpdateCallback = null;
		this.incomingL2CAPBuffer = []; // [Buffer]
		this.outgoingL2CAPBuffer = new Queue(); // [{isFirst, buffer, sentCallback, completeCallback}]
		this.outgoingL2CAPPacketsInController = [];
	}
	util.inherits(AclConnection, EventEmitter);
	
	function reallySendCommand(opcode, buffer, callback, handle) {
		if (isStopped) {
			return;
		}
		pendingCommand = {opcode: opcode, callback: callback, handle: handle, ignoreResponse: false};
		var header = new PacketWriter().u8(HCI_COMMAND_PKT).u16(opcode).u8(buffer.length).toBuffer();
		transport.write(Buffer.concat([header, buffer]));
	}
	
	function sendCommand(opcode, buffer, callback, handle) {
		if (isStopped) {
			return;
		}
		if (handle != 0 && !handle) {
			handle = null;
		}
		if (pendingCommand != null) {
			commandQueue.push({opcode: opcode, buffer: buffer, callback: callback, handle: handle});
		} else {
			reallySendCommand(opcode, buffer, callback, handle);
		}
	}
	
	function triggerSendPackets(conn) {
		while (numFreeBuffers != 0) {
			if (isStopped) {
				return;
			}
			var handle;
			if (!conn) {
				var candidates = [];
				for (var handle in activeConnections) {
					if (!(handle in activeConnections)) {
						continue;
					}
					var c = activeConnections[handle];
					if (c.outgoingL2CAPBuffer.getLength() != 0 && !c.disconnecting) {
						candidates.push(handle);
					}
				}
				if (candidates.length == 0) {
					break;
				}
				handle = candidates[Math.floor(Math.random() * candidates.length)];
				selectedConn = activeConnections[handle];
			} else {
				if (conn.disconnecting) {
					break;
				}
				handle = conn.handle;
				selectedConn = conn;
			}
			var item = selectedConn.outgoingL2CAPBuffer.shift();
			if (!item) {
				break;
			}
			--numFreeBuffers;
			var isFirst = item.isFirst;
			var buffer = item.buffer;
			selectedConn.outgoingL2CAPPacketsInController.push(item.completeCallback);
			var header = new PacketWriter().u8(HCI_ACLDATA_PKT).u16((handle & 0xfff) | (isFirst ? 0 : 0x1000)).u16(buffer.length).toBuffer();
			transport.write(Buffer.concat([header, buffer]));
			if (item.sentCallback) {
				item.sentCallback();
			}
		}
	}
	
	this.sendData = function(handle, cid, data, sentCallback, completeCallback) {
		if (isStopped) {
			return;
		}
		data = Buffer.concat([new PacketWriter().u16(data.length).u16(cid).toBuffer(), data]);
		
		var conn = activeConnections[handle];
		
		for (var i = 0; i < data.length; i += aclMtu) {
			var isFirst = i == 0;
			var isLast = i + aclMtu >= data.length;
			var slice = data.slice(i, isLast ? data.length : i + aclMtu);
			conn.outgoingL2CAPBuffer.push({isFirst: isFirst, buffer: slice, sentCallback: isLast ? sentCallback : null, completeCallback: isLast ? completeCallback : null});
		}
		
		triggerSendPackets(conn);
	};
	
	this.disconnect = function(handle, reason) {
		sendCommand(DISCONNECT_CMD, new PacketWriter().u16(handle).u8(reason).toBuffer(), function(status, r) {
			// Ignore
		}, handle);
	};
	
	this.readRemoteVersionInformation = function(handle, callback) {
		sendCommand(READ_REMOTE_VERSION_INFORMATION_CMD, new PacketWriter().u16(handle).toBuffer(), function(status, r) {
			if (status != 0) {
				callback(status);
			} else {
				activeConnections[handle].readRemoteVersionInformationCallback = callback;
			}
		}, handle);
	};
	
	this.setEventMask = function(low, high, callback) {
		sendCommand(SET_EVENT_MASK_CMD, new PacketWriter().u32(low).u32(high).toBuffer(), callback);
	};
	
	this.reset = function(callback) {
		sendCommand(RESET_CMD, EMPTY_BUFFER, function(status, r) {
			if (status == 0) {
				activeConnections = Object.create(null);
				hasSeparateLeAclBuffers = null;
				aclMtu = 0;
				numFreeBuffers = 0;
				advCallback = null;
				connCallback = null;
				scanCallback = null;
				leReadLocalP256PublicKeyCallback = null;
				leGenerateDHKeyCallback = null;
			}
			callback(status);
		});
	};
	
	this.readLocalVersionInformation = function(callback) {
		sendCommand(READ_LOCAL_VERSION_INFORMATION_CMD, EMPTY_BUFFER, function(status, r) {
			if (status == 0) {
				var hciVersion = r.u8();
				var hciRevision = r.u16();
				var lmpPalVersion = r.u8();
				var manufacturerName = r.u16();
				var lmpPalSubversion = r.u16();
				callback(status, hciVersion, hciRevision, lmpPalVersion, manufacturerName, lmpPalSubversion);
			} else {
				callback(status);
			}
		});
	};
	
	this.readBdAddr = function(callback) {
		sendCommand(READ_BD_ADDR_CMD, EMPTY_BUFFER, function(status, r) {
			if (status == 0) {
				var bdAddr = r.bdAddr();
				callback(status, bdAddr);
			} else {
				callback(status);
			}
		});
	};
	
	this.readBufferSize = function(callback) {
		sendCommand(READ_BUFFER_SIZE_CMD, EMPTY_BUFFER, function(status, r) {
			if (status == 0) {
				var aclPacketLength = r.u16();
				var syncPacketLength = r.u8();
				var numAclPackets = r.u16();
				var numSyncPackets = r.u16();
				if (hasSeparateLeAclBuffers === false && aclMtu == 0) {
					aclMtu = Math.min(aclPacketLength, 1023); // Linux can't handle more than 1023 bytes
					numFreeBuffers = numAclPackets;
				}
				callback(status, aclPacketLength, syncPacketLength, numAclPackets, numSyncPackets);
			} else {
				callback(status);
			}
		});
	};
	
	this.readRssi = function(handle, callback) {
		sendCommand(READ_RSSI_CMD, new PacketWriter().u16(handle).toBuffer(), function(status, r) {
			if (status == 0) {
				r.u16(); // handle
				var rssi = r.i8();
				callback(status, rssi);
			} else {
				callback(status);
			}
		}, handle);
	};
	
	this.leSetEventMask = function(low, high, callback) {
		sendCommand(LE_SET_EVENT_MASK_CMD, new PacketWriter().u32(low).u32(high).toBuffer(), callback);
	};
	
	this.leReadBufferSize = function(callback) {
		sendCommand(LE_READ_BUFFER_SIZE_CMD, EMPTY_BUFFER, function(status, r) {
			if (status == 0) {
				var packetLength = r.u16();
				var numPackets = r.u8();
				if (hasSeparateLeAclBuffers == null) {
					aclMtu = Math.min(packetLength, 1023); // Linux can't handle more than 1023 bytes
					numFreeBuffers = numPackets;
				}
				hasSeparateLeAclBuffers = packetLength != 0;
				callback(status, packetLength, numPackets);
			} else {
				callback(status);
			}
		});
	};
	
	this.leReadLocalSupportedFeatures = function(callback) {
		sendCommand(LE_READ_LOCAL_SUPPORTED_FEATURES_CMD, EMPTY_BUFFER, function(status, r) {
			if (status == 0) {
				var low = r.u32();
				var high = r.u32();
				callback(status, low, high);
			} else {
				callback(status);
			}
		});
	};
	
	this.leSetRandomAddress = function(randomAddress, callback) {
		sendCommand(LE_SET_RANDOM_ADDRESS_CMD, new PacketWriter().bdAddr(randomAddress).toBuffer(), callback);
	};
	
	this.leSetAdvertisingParameters = function(advertisingIntervalMin, advertisingIntervalMax, advertisingType, ownAddressType, peerAddressType, peerAddress, advertisingChannelMap, advertisingFilterPolicy, callback) {
		var pkt = new PacketWriter().u16(advertisingIntervalMin).u16(advertisingIntervalMax).u8(advertisingType).u8(ownAddressType).u8(peerAddressType).bdAddr(peerAddress).u8(advertisingChannelMap).u8(advertisingFilterPolicy).toBuffer();
		sendCommand(LE_SET_ADVERTISING_PARAMETERS_CMD, pkt, callback);
	};
	
	this.leReadAdvertisingChannelTxPower = function(callback) {
		sendCommand(LE_READ_ADVERTISING_CHANNEL_TX_POWER_CMD, EMPTY_BUFFER, function(status, r) {
			if (status == 0) {
				var transmitPowerLevel = r.i8();
				callback(status, transmitPowerLevel);
			} else {
				callback(status);
			}
		});
	};
	
	this.leSetAdvertisingData = function(advertisingData, callback) {
		var pkt = Buffer.alloc(32);
		pkt[0] = advertisingData.length;
		advertisingData.copy(pkt, 1);
		sendCommand(LE_SET_ADVERTISING_DATA_CMD, pkt, callback);
	};
	
	this.leSetScanResponseData = function(scanResponseData, callback) {
		var pkt = Buffer.alloc(32);
		pkt[0] = scanResponseData.length;
		scanResponseData.copy(pkt, 1);
		sendCommand(LE_SET_SCAN_RESPONSE_DATA_CMD, pkt, callback);
	};
	
	var that = this;
	this.leSetAdvertisingEnable = function(advertisingEnable, callback, advConnCallback) {
		sendCommand(LE_SET_ADVERTISING_ENABLE_CMD, new PacketWriter().u8(advertisingEnable ? 1 : 0).toBuffer(), function(status, r) {
			//console.log("leSetAdvertisingEnable done " + advertisingEnable + " " + status);
			if (advertisingEnable && status == 0) {
				//console.log("setting advCallback to " + advConnCallback);
				advCallback = advConnCallback;
			}
			callback(status);
		});
	};
	
	this.leSetScanParameters = function(leScanType, leScanInterval, leScanWindow, ownAddressType, scanningFilterPolicy, callback) {
		var pkt = new PacketWriter().u8(leScanType).u16(leScanInterval).u16(leScanWindow).u8(ownAddressType).u8(scanningFilterPolicy).toBuffer();
		sendCommand(LE_SET_SCAN_PARAMETERS_CMD, pkt, callback);
	};
	
	this.leSetScanEnable = function(leScanEnable, filterDuplicates, reportCallback, callback) {
		var pkt = new PacketWriter().u8(leScanEnable ? 1 : 0).u8(filterDuplicates ? 1 : 0).toBuffer();
		sendCommand(LE_SET_SCAN_ENABLE_CMD, pkt, function(status, r) {
			if (status == 0) {
				scanCallback = leScanEnable ? reportCallback : null;
			}
			callback(status);
		});
	};
	
	this.leCreateConnection = function(leScanInterval, leScanWindow, initiatorFilterPolicy, peerAddressType, peerAddress, ownAddressType, connIntervalMin, connIntervalMax, connLatency, supervisionTimeout, minCELen, maxCELen, callback, completeCallback) {
		var pkt = new PacketWriter().u16(leScanInterval).u16(leScanWindow).u8(initiatorFilterPolicy).u8(peerAddressType).bdAddr(peerAddress).u8(ownAddressType).u16(connIntervalMin).u16(connIntervalMax).u16(connLatency).u16(supervisionTimeout).u16(minCELen).u16(maxCELen).toBuffer();
		sendCommand(LE_CREATE_CONNECTION_CMD, pkt, function(status, r) {
			if (status == 0) {
				connCallback = completeCallback;
			}
			callback(status);
		});
	};
	
	this.leCreateConnectionCancel = function(callback) {
		sendCommand(LE_CREATE_CONNECTION_CANCEL_CMD, EMPTY_BUFFER, callback);
	};
	
	this.leReadWhiteListSize = function(callback) {
		sendCommand(LE_READ_WHITE_LIST_SIZE_CMD, EMPTY_BUFFER, function(status, r) {
			if (status == 0) {
				var whiteListSize = r.u8();
				callback(status, whiteListSize);
			} else {
				callback(status);
			}
		});
	};
	
	this.leClearWhiteList = function(callback) {
		sendCommand(LE_CLEAR_WHITE_LIST_CMD, EMPTY_BUFFER, callback);
	};
	
	this.leAddDeviceToWhiteList = function(addressType, address, callback) {
		sendCommand(LE_ADD_DEVICE_TO_WHITE_LIST_CMD, new PacketWriter().u8(addressType).bdAddr(address).toBuffer(), callback);
	};
	
	this.leRemoveDeviceFromWhiteList = function(addressType, address, callback) {
		sendCommand(LE_REMOVE_DEVICE_FROM_WHITE_LIST_CMD, new PacketWriter().u8(addressType).bdAddr(address).toBuffer(), callback);
	};
	
	this.leConnectionUpdate = function(handle, intervalMin, intervalMax, latency, timeout, minCELen, maxCELen, callback) {
		var pkt = new PacketWriter().u16(handle).u16(intervalMin).u16(intervalMax).u16(latency).u16(timeout).u16(minCELen).u16(maxCELen).toBuffer();
		sendCommand(LE_CONNECTION_UPDATE_CMD, pkt, function(status, r) {
			if (status != 0) {
				callback(status);
			} else {
				activeConnections[handle].leConnectionUpdateCallback = callback;
			}
		}, handle);
	};
	
	this.leReadRemoteUsedFeatures = function(handle, callback) {
		sendCommand(LE_READ_REMOTE_USED_FEATURES_CMD, new PacketWriter().u16(handle).toBuffer(), function(status, r) {
			if (status != 0) {
				callback(status);
			} else {
				activeConnections[handle].leReadRemoteUsedFeaturesCallback = callback;
			}
		}, handle);
	};
	
	this.leStartEncryption = function(handle, randomNumber, ediv, ltk, statusCallback, completeCallback) {
		var pkt = new PacketWriter().u16(handle).buffer(randomNumber).u16(ediv).buffer(ltk).toBuffer();
		sendCommand(LE_START_ENCRYPTION_CMD, pkt, function(status, r) {
			if (status == 0) {
				activeConnections[handle].encryptionChangeCallback = completeCallback;
			}
			statusCallback(status);
		}, handle);
	};
	
	this.leLongTermKeyRequestReply = function(handle, ltk, callback) {
		sendCommand(LE_LONG_TERM_KEY_REQUEST_REPLY_CMD, new PacketWriter().u16(handle).buffer(ltk).toBuffer(), function(status, r) {
			// NOTE: Connection_Handle is also sent, but should be redundant
			if (status != 0) {
				callback(status);
			} else {
				activeConnections[handle].encryptionChangeCallback = callback;
			}
		}, handle);
	};
	
	this.leLongTermKeyNequestNegativeReply = function(handle, callback) {
		sendCommand(LE_LONG_TERM_KEY_REQUEST_NEGATIVE_REPLY_CMD, new PacketWriter().u16(handle).toBuffer(), function(status, r) {
			// NOTE: Connection_Handle is also sent, but should be redundant
			callback(status);
		}, handle);
	};
	
	this.leReadSupportedStates = function(callback) {
		sendCommand(LE_READ_SUPPORTED_STATES_CMD, EMPTY_BUFFER, function(status, r) {
			if (status == 0) {
				var low = r.u32();
				var high = r.u32();
				callback(status, low, high);
			} else {
				callback(status);
			}
		});
	};
	
	this.leSetDataLength = function(handle, txOctets, txTime, callback) {
		sendCommand(LE_SET_DATA_LENGTH_CMD, new PacketWriter().u16(handle).u16(txOctets).u16(txTime).toBuffer(), function(status, r) {
			callback(status, handle);
		});
	};
	
	this.leReadSuggestedDefaultDataLength = function(callback) {
		sendCommand(LE_READ_SUGGESTED_DEFAULT_DATA_LENGTH_CMD, EMPTY_BUFFER, function(status, r) {
			if (status == 0) {
				var suggestedMaxTxOctets = r.u16();
				var suggestedMaxTxTime = r.u16();
				callback(status, suggestedMaxTxOctets, suggestedMaxTxTime);
			} else {
				callback(status);
			}
		});
	};
	
	this.leWriteSuggestedDefaultDataLength = function(suggestedMaxTxOctets, suggestedMaxTxTime, callback) {
		sendCommand(LE_WRITE_SUGGESTED_DEFAULT_DATA_LENGTH_CMD, new PacketWriter().u16(suggestedMaxTxOctets).u16(suggestedMaxTxTime).toBuffer(), callback);
	};
	
	this.leReadLocalP256PublicKey = function(callback) {
		sendCommand(LE_READ_LOCAL_P256_PUBLIC_KEY_CMD, EMPTY_BUFFER, function(status, r) {
			if (status == 0) {
				leReadLocalP256PublicKeyCallback = callback;
			} else {
				callback(status);
			}
		});
	};
	
	this.leGenerateDHKey = function(remoteP256PublicKey, callback) {
		sendCommand(LE_GENERATE_DHKEY_CMD, new PacketWriter().buffer(remoteP256PublicKey).toBuffer(), function(status, r) {
			if (status == 0) {
				leGenerateDHKeyCallback = callback;
			} else {
				callback(status);
			}
		});
	};
	
	this.leReadMaximumDataLength = function(callback) {
		sendCommand(LE_READ_MAXIMUM_DATA_LENGTH_CMD, EMPTY_BUFFER, function(status, r) {
			if (status == 0) {
				var supportedMaxTxOctets = r.u16();
				var supportedMaxTxTime = r.u16();
				var supportedMaxRxOctets = r.u16();
				var supportedMaxRxTime = r.u16();
				callback(status, supportedMaxRxOctets, supportedMaxTxTime, supportedMaxRxOctets, supportedMaxRxTime);
			} else {
				callback(status);
			}
		});
	};
	
	this.leSetDefaultPhy = function(allPhys, txPhys, rxPhys, callback) {
		sendCommand(LE_SET_DEFAULT_PHY_CMD, new PacketWriter().u8(allPhys).u8(txPhys).u8(rxPhys).toBuffer(), callback);
	};
	
	this.leSetPhy = function(handle, allPhys, txPhys, rxPhys, phyOptions, callback) {
		sendCommand(LE_SET_PHY_CMD, new PacketWriter().u16(handle).u8(allPhys).u8(txPhys).u8(rxPhys).u16(phyOptions).toBuffer(), function(status, r) {
			if (status != 0) {
				callback(status);
			} else {
				activeConnections[handle].lePhyUpdateCallback = callback;
			}
		});
	};
	
	this.leSetExtendedScanParameters = function(ownAddressType, scanningFilterPolicy, scanningPhys, phyArr, callback) {
		var writer = new PacketWriter().u8(ownAddressType).u8(scanningFilterPolicy).u8(scanningPhys);
		var arrPos = 0;
		if (scanningPhys & 1) {
			// 1M
			writer.u8(phyArr[arrPos].scanType).u16(phyArr[arrPos].scanInterval).u16(phyArr[arrPos].scanWindow);
			++arrPos;
		}
		if (scanningPhys & 4) {
			// Coded PHY
			writer.u8(phyArr[arrPos].scanType).u16(phyArr[arrPos].scanInterval).u16(phyArr[arrPos].scanWindow);
			++arrPos;
		}
		sendCommand(LE_SET_EXTENDED_SCAN_PARAMETERS_CMD, writer.toBuffer(), callback);
	};
	
	this.leSetExtendedScanEnable = function(leScanEnable, filterDuplicates, duration, period, reportCallback, callback) {
		var pkt = new PacketWriter().u8(leScanEnable ? 1 : 0).u8(filterDuplicates).u16(duration).u16(period).toBuffer();
		sendCommand(LE_SET_EXTENDED_SCAN_ENABLE_CMD, pkt, function(status, r) {
			if (status == 0) {
				scanCallback = leScanEnable ? reportCallback : null;
			}
			callback(status);
		});
	};
	
	this.leExtendedCreateConnection = function(initiatorFilterPolicy, ownAddressType, peerAddressType, peerAddress, initiatingPhys, phyArr, callback, completeCallback) {
		var writer = new PacketWriter().u8(initiatorFilterPolicy).u8(ownAddressType).u8(peerAddressType).bdAddr(peerAddress).u8(initiatingPhys);
		var arrPos = 0;
		for (var i = 0; i < 3; i++) {
			if (initiatingPhys & (1 << i)) {
				writer.u16(phyArr[arrPos].scanInterval).u16(phyArr[arrPos].scanWindow).u16(phyArr[arrPos].connIntervalMin).u16(phyArr[arrPos].connIntervalMax).u16(phyArr[arrPos].connLatency).u16(phyArr[arrPos].supervisionTimeout).u16(phyArr[arrPos].minCELen).u16(phyArr[arrPos].maxCELen);
				++arrPos;
			}
		}
		sendCommand(LE_EXTENDED_CREATE_CONNECTION_CMD, writer.toBuffer(), function(status, r) {
			if (status == 0) {
				connCallback = completeCallback;
			}
			callback(status);
		});
	};
	
	this.leSetExtendedAdvertisingParameters = function(advertisingHandle, advertisingEventProperties, primaryAdvertisingIntervalMin, primaryAdvertisingIntervalMax, primaryAdvertisingChannelMap, ownAddressType, peerAddressType, peerAddress, advertisingFilterPolicy, advertisingTxPower, primaryAdvertisingPhy, secondaryAdvertisingMaxSkip, secondaryAdvertisingPhy, advertisingSid, scanRequestNotificationEnable, callback) {
		var pkt = new PacketWriter()
			.u8(advertisingHandle)
			.u16(advertisingEventProperties)
			.u24(primaryAdvertisingIntervalMin)
			.u24(primaryAdvertisingIntervalMax)
			.u8(primaryAdvertisingChannelMap)
			.u8(ownAddressType)
			.u8(peerAddressType)
			.bdAddr(peerAddress)
			.u8(advertisingFilterPolicy)
			.i8(advertisingTxPower)
			.u8(primaryAdvertisingPhy)
			.u8(secondaryAdvertisingMaxSkip)
			.u8(secondaryAdvertisingPhy)
			.u8(advertisingSid)
			.u8(scanRequestNotificationEnable)
			.toBuffer();
		sendCommand(LE_SET_EXTENDED_ADVERTISING_PARAMETERS_CMD, pkt, function(status, r) {
			if (status == 0) {
				var selectedTxPower = r.i8();
				callback(status, selectedTxPower);
			} else {
				callback(status);
			}
		});
		
	};
	
	this.leSetExtendedAdvertisingEnable = function(enable, advertisingSets, callback) {
		var writer = new PacketWriter().u8(enable).u8(advertisingSets.length);
		for (var i = 0; i < advertisingSets.length; i++) {
			var set = advertisingSets[i];
			writer.u8(set.advertisingHandle).u16(set.duration).u8(set.maxExtendedAdvertisingEvents);
		}
		sendCommand(LE_SET_EXTENDED_ADVERTISING_ENABLE_CMD, writer.toBuffer(), function(status) {
			if (status == 0 && enable) {
				// TODO: If multiple sets, multiple callbacks needed
				advCallback = callback;
			} else {
				callback(status);
			}
		});
	};
	
	function handleDisconnectionComplete(r) {
		var status = r.u8();
		if (status != 0) {
			return;
		}
		var handle = r.u16();
		var reason = r.u8();
		var conn = activeConnections[handle];
		if (!conn) {
			return;
		}
		delete activeConnections[handle];
		commandQueue = commandQueue.filter(cmd => cmd.handle != handle);
		if (pendingCommand != null && pendingCommand.handle == handle) {
			pendingCommand.ignoreResponse = true;
		}
		numFreeBuffers += conn.outgoingL2CAPPacketsInController.length;
		conn.emit('disconnect', reason);
		triggerSendPackets();
	}
	function handleEncryptionChange(r) {
		var status = r.u8();
		var handle = r.u16();
		var conn = activeConnections[handle];
		if (!conn) {
			return;
		}
		var callback = conn.encryptionChangeCallback;
		if (callback) {
			conn.encryptionChangeCallback = null;
			if (status != 0) {
				callback(status);
				return;
			}
			var encryptionEnabled = r.u8();
			callback(status, encryptionEnabled);
		}
	}
	function handleReadRemoteVersionInformationComplete(r) {
		var status = r.u8();
		var handle = r.u16();
		var conn = activeConnections[handle];
		if (!conn) {
			return;
		}
		var callback = conn.readRemoteVersionInformationCallback;
		if (callback) {
			conn.readRemoteVersionInformationCallback = null;
			if (status != 0) {
				callback(status);
				return;
			}
			var version = r.u8();
			var manufacturer = r.u16();
			var subversion = r.u16();
			callback(status, version, manufacturer, subversion);
		}
	}
	function handleHardwareError(r) {
		var hardwareCode = r.u8();
		pendingCommand = null;
		commandQueue = [];
		// Rest will be reset when Reset Command is sent
		hardwareErrorCallback(hardwareCode);
	}
	function handleNumberOfCompletePackets(r) {
		var numHandles = r.u8();
		var callbacks = [];
		for (var i = 0; i < numHandles; i++) {
			var handle = r.u16();
			var numCompleted = r.u16();
			var conn = activeConnections[handle];
			if (!conn) {
				// TODO: Print warning about buggy controller
				continue;
			}
			if (numCompleted > conn.outgoingL2CAPPacketsInController.length) {
				// TODO: Print warning about buggy controller
				numCompleted = conn.outgoingL2CAPPacketsInController.length;
			}
			numFreeBuffers += numCompleted;
			callbacks.push(conn.outgoingL2CAPPacketsInController.splice(0, numCompleted));
		}
		for (var i = 0; i < callbacks.length; i++) {
			for (var j = 0; j < callbacks[i].length; j++) {
				if (callbacks[i][j]) {
					callbacks[i][j]();
				}
			}
		}
		triggerSendPackets();
	}
	function handleEncryptionKeyRefreshComplete(r) {
		var status = r.u8();
		var handle = r.u16();
		var conn = activeConnections[handle];
		if (!conn) {
			return;
		}
		var callback = conn.encryptionChangeCallback;
		if (callback) {
			conn.encryptionChangeCallback = null;
			if (status == 0) {
				callback(status, 0x01);
			} else {
				callback(status);
			}
		}
	}
	function handleLeConnectionComplete(r) {
		var status = r.u8();
		if (status == Errors.HCI_DIRECTED_ADV_TIMEOUT) {
			var ac = advCallback;
			advCallback = null;
			if (ac) {
				ac(status);
			}
		} else if (status != 0) {
			var cc = connCallback;
			connCallback = null;
			if (cc) {
				cc(status);
			}
		} else {
			var handle = r.u16();
			var role = r.u8();
			var peerAddressType = r.u8();
			var peerAddress = r.bdAddr();
			var connInterval = r.u16();
			var connLatency = r.u16();
			var supervisionTimeout = r.u16();
			var masterClockAccuracy = r.u8();
			
			if (handle in activeConnections) {
				// TODO: what to do here?
				throw new Error('Handle ' + handle + ' already connected');
			}
			
			var aclConn = new AclConnection(handle, role);
			activeConnections[handle] = aclConn;
			
			var callback;
			if (role == ROLE_MASTER) {
				callback = connCallback;
				connCallback = null;
			} else {
				//console.log("slave conn complete " + advCallback);
				callback = advCallback;
				advCallback = null;
				if (!callback) {
					// Unexpected, kill this connection
					var reason = 0x13;
					sendCommand(DISCONNECT_CMD, new PacketWriter().u16(handle).u8(reason).toBuffer(), function(status, r) {
						// Ignore
					}, handle);
					return;
				}
			}
			callback(status, aclConn, role, peerAddressType, peerAddress, connInterval, connLatency, supervisionTimeout, masterClockAccuracy);
		}
	}
	function handleLeAdvertisingReport(r) {
		if (scanCallback) {
			var numReports = r.u8();
			for (var i = 0; i < numReports; i++) {
				var eventType = r.u8();
				var addressType = r.u8();
				var address = r.bdAddr();
				var lengthData = r.u8();
				var data = r.buffer(lengthData);
				var rssi = r.i8();
				
				scanCallback(eventType, addressType, address, data, rssi);
			}
		}
	}
	function handleLeConnectionUpdateComplete(r) {
		var status = r.u8();
		var handle = r.u16();
		var conn = activeConnections[handle];
		if (!conn) {
			return;
		}
		var interval, latency, timeout;
		var callback = conn.leConnectionUpdateCallback;
		if (status == 0) {
			interval = r.u16();
			latency = r.u16();
			timeout = r.u16();
		}
		if (callback) {
			conn.leConnectionUpdateCallback = null;
			if (status != 0) {
				callback(status);
				return;
			}
			callback(status, interval, latency, timeout);
		}
		if (status == 0) {
			conn.emit('connectionUpdate', interval, latency, timeout);
		}
	}
	function handleLeReadRemoteUsedFeaturesComplete(r) {
		var status = r.u8();
		var handle = r.u16();
		var conn = activeConnections[handle];
		if (!conn) {
			return;
		}
		var callback = conn.leReadRemoteUsedFeaturesCallback;
		if (callback) {
			conn.leReadRemoteUsedFeaturesCallback = null;
			if (status != 0) {
				callback(status);
				return;
			}
			var low = r.u32();
			var high = r.u32();
			callback(status, low, high);
		}
	}
	function handleLeLongTermKeyRequest(r) {
		var handle = r.u16();
		var conn = activeConnections[handle];
		if (!conn || conn.role != ROLE_SLAVE) {
			return;
		}
		var randomNumber = r.buffer(8);
		var ediv = r.u16();
		conn.emit('ltkRequest', randomNumber, ediv);
	}
	function handleLeReadLocalP256PublicKeyComplete(r) {
		var status = r.u8();
		var callback = leReadLocalP256PublicKeyCallback;
		if (callback) {
			leReadLocalP256PublicKeyCallback = null;
			if (status != 0) {
				callback(status);
				return;
			}
			var localP256PublicKey = r.buffer(64);
			callback(status, localP256PublicKey);
		}
	}
	function handleLeGenerateDHKeyComplete(r) {
		var status = r.u8();
		var callback = leGenerateDHKeyCallback;
		if (callback) {
			leGenerateDHKeyCallback = null;
			if (status != 0) {
				callback(status);
				return;
			}
			var dhKey = r.buffer(32);
			callback(status, dhKey);
		}
	}
	function handleLeEnhancedConnectionComplete(r) {
		var status = r.u8();
		if (status == Errors.HCI_DIRECTED_ADV_TIMEOUT) {
			var ac = advCallback;
			advCallback = null;
			if (ac) {
				ac(status);
			}
		} else if (status != 0) {
			var cc = connCallback;
			connCallback = null;
			if (cc) {
				cc(status);
			}
		} else {
			var handle = r.u16();
			var role = r.u8();
			var peerAddressType = r.u8();
			var peerAddress = r.bdAddr();
			var localResolvablePrivateAddress = r.bdAddr();
			var peerResolvablePrivateAddress = r.bdAddr();
			var connInterval = r.u16();
			var connLatency = r.u16();
			var supervisionTimeout = r.u16();
			var masterClockAccuracy = r.u8();
			
			if (handle in activeConnections) {
				// TODO: what to do here?
				throw new Error('Handle ' + handle + ' already connected');
			}
			
			var aclConn = new AclConnection(handle, role);
			activeConnections[handle] = aclConn;
			
			var callback;
			if (role == ROLE_MASTER) {
				callback = connCallback;
				connCallback = null;
			} else {
				//console.log("slave conn complete " + advCallback);
				callback = advCallback;
				advCallback = null;
			}
			callback(status, aclConn, role, peerAddressType, peerAddress, localResolvablePrivateAddress, peerResolvablePrivateAddress, connInterval, connLatency, supervisionTimeout, masterClockAccuracy);
		}
	}
	function handleLePhyUpdateComplete(r) {
		var status = r.u8();
		var handle = r.u16();
		var conn = activeConnections[handle];
		if (!conn) {
			return;
		}
		var txPhy, rxPhy;
		var callback = conn.lePhyUpdateCallback;
		if (status == 0) {
			txPhy = r.u8();
			rxPhy = r.u8();
		}
		if (callback) {
			conn.lePhyUpdateCallback = null;
			if (status != 0) {
				callback(status);
				return;
			}
			callback(status, txPhy, rxPhy);
		}
		if (status == 0) {
			conn.emit('connectionUpdate', txPhy, rxPhy);
		}
	}
	function handleLeExtendedAdvertisingReport(r) {
		if (scanCallback) {
			var numReports = r.u8();
			for (var i = 0; i < numReports; i++) {
				var eventType = r.u16();
				var addressType = r.u8();
				var address = r.bdAddr();
				var primaryPhy = r.u8();
				var secondaryPhy = r.u8();
				var advertisingSid = r.u8();
				var txPower = r.i8();
				var rssi = r.i8();
				var periodicAdvertisingInterval = r.u16();
				var directAddressType = r.u8();
				var directAddress = r.bdAddr();
				var lengthData = r.u8();
				var data = r.buffer(lengthData);
				
				scanCallback(eventType, addressType, address, primaryPhy, secondaryPhy, advertisingSid, txPower, rssi, periodicAdvertisingInterval, directAddressType, directAddress, data);
			}
		}
	}
	
	function onData(data) {
		function throwInvalidLength() {
			throw new Error('invalid packet length');
		}
		if (data.length == 0) {
			throwInvalidLength();
		}
		var r = new PacketReader(data, throwInvalidLength);
		var packetType = r.u8();
		if (packetType == HCI_EVENT_PKT) {
			if (data.length < 3) {
				throwInvalidLength();
			}
			var eventCode = r.u8();
			var paramLen = r.u8();
			if (paramLen + 3 != data.length) {
				throwInvalidLength();
			}
			if (eventCode == EVT_CMD_COMPLETE || eventCode == EVT_CMD_STATUS) {
				var status;
				if (eventCode == EVT_CMD_STATUS) {
					status = r.u8();
				}
				var numPkts = r.u8();
				var opcode = r.u16();
				
				if (pendingCommand == null || pendingCommand.opcode != opcode) {
					// TODO: ignore? probably command sent by other process
				} else {
					if (eventCode == EVT_CMD_COMPLETE) {
						status = r.u8(); // All packets we can handle have status as first parameter
					}
					
					var pc = pendingCommand;
					pendingCommand = null;
					if (commandQueue.length != 0) {
						var cmd = commandQueue.shift();
						reallySendCommand(cmd.opcode, cmd.buffer, cmd.callback, cmd.handle);
					}
					if (pc.callback && !pc.ignoreResponse) {
						pc.callback(status, r);
					}
				}
			} else {
				switch (eventCode) {
					case EVT_DISCONNECTION_COMPLETE: handleDisconnectionComplete(r); break;
					case EVT_ENCRYPTION_CHANGE: handleEncryptionChange(r); break;
					case EVT_READ_REMOTE_VERSION_INFORMATION_COMPLETE: handleReadRemoteVersionInformationComplete(r); break;
					case EVT_HARDWARE_ERROR: handleHardwareError(r); break;
					case EVT_NUMBER_OF_COMPLETE_PACKETS: handleNumberOfCompletePackets(r); break;
					case EVT_ENCRYPTION_KEY_REFRESH_COMPLETE: handleEncryptionKeyRefreshComplete(r); break;
					case EVT_LE_META: switch(r.u8()) {
						case EVT_LE_CONNECTION_COMPLETE: handleLeConnectionComplete(r); break;
						case EVT_LE_ADVERTISING_REPORT: handleLeAdvertisingReport(r); break;
						case EVT_LE_CONNECTION_UPDATE_COMPLETE: handleLeConnectionUpdateComplete(r); break;
						case EVT_LE_READ_REMOTE_USED_FEATURES_COMPLETE: handleLeReadRemoteUsedFeaturesComplete(r); break;
						case EVT_LE_LONG_TERM_KEY_REQUEST: handleLeLongTermKeyRequest(r); break;
						case EVT_LE_READ_LOCAL_P256_PUBLIC_KEY_COMPLETE: handleLeReadLocalP256PublicKeyComplete(r); break;
						case EVT_LE_GENERATE_DHKEY_COMPLETE: handleLeGenerateDHKeyComplete(r); break;
						case EVT_LE_ENHANCED_CONNECTION_COMPLETE: handleLeEnhancedConnectionComplete(r); break;
						case EVT_LE_PHY_UPDATE_COMPLETE: handleLePhyUpdateComplete(r); break;
						case EVT_LE_EXTENDED_ADVERTISING_REPORT: handleLeExtendedAdvertisingReport(r); break;
					}
				}
			}
		} else if (packetType == HCI_ACLDATA_PKT) {
			if (data.length < 5) {
				throwInvalidLength();
			}
			var conhdl = r.u16();
			var pb = (conhdl >> 12) & 0x3;
			var bc = (conhdl >> 14) & 0x3;
			conhdl &= 0xfff;
			var len = r.u16();
			var aclConn = activeConnections[conhdl];
			if (aclConn) {
				var ib = aclConn.incomingL2CAPBuffer;
				if (pb == 2) {
					// First packet
					if (ib.length != 0) {
						// Warning: incomplete incoming packet, dropping
						ib.length = 0;
					}
					ib.totalLength = 0;
					//console.log('first packet');
					if (len < 4) {
						// Possibly invalid on the LL layer, but allow this
						ib.push(r.getRemainingBuffer());
						ib.totalLength += ib[ib.length - 1].length;
					} else {
						var l2capLength = (data[5] | (data[6] << 8));
						//console.log('l2capLength: ' + l2capLength + ', len: ' + len);
						if (4 + l2capLength == len) {
							// Full complete packet
							r.u16(); // Length
							var cid = r.u16();
							//console.log('full packet with cid ' + cid);
							aclConn.emit('data', cid, r.getRemainingBuffer());
						} else if (4 + l2capLength < len) {
							// Invalid, dropping
						} else if (4 + l2capLength > len) {
							ib.push(r.getRemainingBuffer());
							ib.totalLength += ib[ib.length - 1].length;
						}
					}
				} else if (pb == 1) {
					// Continuation
					var buf = r.getRemainingBuffer();
					if (ib.length == 0) {
						// Not a continuation, dropping
					} else {
						if (ib[ib.length - 1].length < 4) {
							ib[ib.length - 1] = Buffer.concat([ib[ib.length - 1], buf]);
						} else {
							ib.push(buf);
						}
						ib.totalLength += buf.length;
						if (ib.totalLength >= 4) {
							var l2capLength = (ib[0][0] | (ib[0][1] << 8));
							if (4 + l2capLength == ib.totalLength) {
								var completePacket = new PacketReader(Buffer.concat(ib, ib.totalLength));
								completePacket.u16(); // Length
								var cid = completePacket.u16();
								ib.length = 0;
								ib.totalLength = 0;
								aclConn.emit('data', cid, completePacket.getRemainingBuffer());
							}
						}
					}
				} else {
					// Invalid pb
				}
			}
		} else {
			// Ignore unknown packet type
		}
	}
	
	transport.on('data', onData);
	
	this.stop = function() {
		if (isStopped) {
			return;
		}
		isStopped = true;
		transport.removeListener('data', onData);
		transport = {write: function(data) {}};
	};
	
	this.getAdvCallback = function() {
		return advCallback;
	};
}

module.exports = function(transport) {
	return new HciAdapter(transport);
};
