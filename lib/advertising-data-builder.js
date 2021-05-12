const utils = require('./internal/utils');

const serializeUuid = utils.serializeUuid;
const bdAddrToBuffer = utils.bdAddrToBuffer;
const isValidBdAddr = utils.isValidBdAddr;

function get16BitUuid(uuid) {
	var serialized = serializeUuid(uuid);
	if (serialized.length != 2) {
		throw new Error('Not a valid 16-bit uuid: ' + uuid);
	}
	return serialized;
}

function get128BitUuid(uuid) {
	uuid = uuid.replace(/-/g, '');
	var serialized = Buffer.from(uuid, 'hex').reverse();
	if (serialized.length != 16) {
		throw new Error('Not a valid 128-bit uuid: ' + uuid);
	}
	return serialized;
}

function AdvertisingDataBuilder() {
	var data = Buffer.alloc(0);
	var hasFlags = false;
	
	function addData(type, buf) {
		if (data.length + 2 + buf.length > 31) {
			throw new Error('This item does not fit, needs ' + (2 + buf.length) + ' bytes but have only ' + (31 - data.length) + ' left');
		}
		data = Buffer.concat([data, Buffer.from([1 + buf.length, type]), buf]);
	}
	
	this.addFlags = function(flags) {
		var keys = ['leLimitedDiscoverableMode',
		'leGeneralDiscoverableMode',
		'brEdrNotSupported',
		'simultaneousLeAndBdEdrToSameDeviceCapableController',
		'simultaneousLeAndBrEdrToSameDeviceCapableHost'];
		
		var flagsByte = 0;
		
		for (var i = 0; i < keys.length; i++) {
			if (flags.includes(keys[i])) {
				flagsByte |= 1 << i;
			}
		}
		
		if (hasFlags) {
			throw new Error('Already has flags');
		}
		
		addData(0x01, Buffer.from([flagsByte]));
		return this;
	};
	
	this.add16BitServiceUUIDs = function(isComplete, uuids) {
		var buf = Buffer.concat(uuids.map(uuid => get16BitUuid(uuid)));
		addData(isComplete ? 0x03 : 0x02, buf);
		return this;
	};
	
	this.add128BitServiceUUIDs = function(isComplete, uuids) {
		var buf = Buffer.concat(uuids.map(uuid => get128BitUuid(uuid)));
		addData(isComplete ? 0x07 : 0x06, buf);
		return this;
	};
	
	this.addLocalName = function(isComplete, name) {
		addData(isComplete ? 0x09 : 0x08, Buffer.from(name));
		return this;
	};
	
	this.addManufacturerData = function(companyIdentifierCode, data) {
		addData(0xff, Buffer.concat([Buffer.from([companyIdentifierCode, companyIdentifierCode >> 8]), data]));
		return this;
	};
	
	this.addTxPowerLevel = function(txPowerLevel) {
		addData(0x0a, Buffer.from([txPowerLevel]));
		return this;
	};
	
	this.addSlaveConnectionIntervalRange = function(connIntervalMin, connIntervalMax) {
		var buf = Buffer.alloc(4);
		buf.writeUInt16LE(connIntervalMin, 0);
		buf.writeUInt16LE(connIntervalMax, 2);
		addData(0x12, buf);
		return this;
	};
	
	this.add16BitServiceSolicitation = function(uuids) {
		var buf = Buffer.concat(uuids.map(uuid => get16BitUuid(uuid)));
		addData(0x14, buf);
		return this;
	};
	
	this.add128BitServiceSolicitation = function(uuids) {
		var buf = Buffer.concat(uuids.map(uuid => get128BitUuid(uuid)));
		addData(0x15, buf);
		return this;
	};
	
	this.add16BitServiceData = function(uuid, data) {
		addData(0x16, Buffer.concat([get16BitUuid(uuid), data]));
		return this;
	};
	
	this.add128BitServiceData = function(uuid, data) {
		addData(0x21, Buffer.concat([get128BitUuid(uuid), data]));
		return this;
	};
	
	this.addAppearance = function(appearanceNumber) {
		addData(0x19, Buffer.from([appearanceNumber, appearanceNumber >> 8]));
		return this;
	};
	
	this.addPublicTargetAddresses = function(addresses) {
		addresses = Buffer.concat(addresses.map(address => {
			if (!isValidBdAddr(address)) {
				throw new Error('Invalid address: ' + address);
			}
			return bdAddrToBuffer(address);
		}));
		addData(0x17, addresses);
		return this;
	};
	
	this.addRandomTargetAddresses = function(addresses) {
		addresses = Buffer.concat(addresses.map(address => {
			if (!isValidBdAddr(address)) {
				throw new Error('Invalid address: ' + address);
			}
			return bdAddrToBuffer(address);
		}));
		addData(0x18, addresses);
		return this;
	};
	
	this.addAdvertisingInterval = function(interval) {
		addData(0x1a, Buffer.from([interval, interval >> 8]));
		return this;
	};
	
	this.addUri = function(uri) {
		addData(0x24, Buffer.from(uri));
		return this;
	};
	
	this.addLeSupportedFeatures = function(low, high) {
		var buf = Buffer.alloc(8);
		buf.writeUInt32LE(low, 0);
		buf.writeUInt32LE(high, 4);
		var len;
		for (len = 8; len > 0; len--) {
			if (buf[len - 1] != 0) {
				break;
			}
		}
		addData(0x27, buf.slice(0, len));
		return this;
	};
	
	this.build = function() {
		return Buffer.from(data);
	};
}

module.exports = AdvertisingDataBuilder;
