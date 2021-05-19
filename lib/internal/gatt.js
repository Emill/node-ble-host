const EventEmitter = require('events');
const util = require('util');
const utils = require('./utils');
const Queue = utils.Queue;
const serializeUuid = utils.serializeUuid;
const AttErrors = require('../att-errors.js');
const storage = require('./storage');

const ATT_ERROR_RESPONSE = 0x01;
const ATT_EXCHANGE_MTU_REQUEST = 0x02;
const ATT_EXCHANGE_MTU_RESPONSE = 0x03;
const ATT_FIND_INFORMATION_REQUEST = 0x04;
const ATT_FIND_INFORMATION_RESPONSE = 0x05;
const ATT_FIND_BY_TYPE_VALUE_REQUEST = 0x06;
const ATT_FIND_BY_TYPE_VALUE_RESPONSE = 0x07;
const ATT_READ_BY_TYPE_REQUEST = 0x08;
const ATT_READ_BY_TYPE_RESPONSE = 0x09;
const ATT_READ_REQUEST = 0x0a;
const ATT_READ_RESPONSE = 0x0b;
const ATT_READ_BLOB_REQUEST = 0x0c;
const ATT_READ_BLOB_RESPONSE = 0x0d;
const ATT_READ_MULTIPLE_REQUEST = 0x0e;
const ATT_READ_MULTIPLE_RESPONSE = 0x0f;
const ATT_READ_BY_GROUP_TYPE_REQUEST = 0x10;
const ATT_READ_BY_GROUP_TYPE_RESPONSE = 0x11;
const ATT_WRITE_REQUEST = 0x12;
const ATT_WRITE_RESPONSE = 0x13;
const ATT_WRITE_COMMAND = 0x52;
const ATT_PREPARE_WRITE_REQUEST = 0x16;
const ATT_PREPARE_WRITE_RESPONSE = 0x17;
const ATT_EXECUTE_WRITE_REQUEST = 0x18;
const ATT_EXECUTE_WRITE_RESPONSE = 0x19;
const ATT_HANDLE_VALUE_NOTIFICATION = 0x1b;
const ATT_HANDLE_VALUE_INDICATION = 0x1d;
const ATT_HANDLE_VALUE_CONFIRMATION = 0x1e;
const ATT_SIGNED_WRITE_COMMAND = 0xd2;

const BASE_UUID_SECOND_PART = '-0000-1000-8000-00805F9B34FB';

function isKnownRequestOpcode(opcode) {
	switch (opcode) {
		case ATT_EXCHANGE_MTU_REQUEST:
		case ATT_FIND_INFORMATION_REQUEST:
		case ATT_FIND_BY_TYPE_VALUE_REQUEST:
		case ATT_READ_BY_TYPE_REQUEST:
		case ATT_READ_REQUEST:
		case ATT_READ_BLOB_REQUEST:
		case ATT_READ_MULTIPLE_REQUEST:
		case ATT_READ_BY_GROUP_TYPE_REQUEST:
		case ATT_WRITE_REQUEST:
		case ATT_PREPARE_WRITE_REQUEST:
		case ATT_EXECUTE_WRITE_REQUEST:
			return true;
		default:
			return false;
	}
}

function isKnownResponseOpcode(opcode) {
	switch (opcode) {
		case ATT_ERROR_RESPONSE:
		case ATT_EXCHANGE_MTU_RESPONSE:
		case ATT_FIND_INFORMATION_RESPONSE:
		case ATT_FIND_BY_TYPE_VALUE_RESPONSE:
		case ATT_READ_BY_TYPE_RESPONSE:
		case ATT_READ_RESPONSE:
		case ATT_READ_BLOB_RESPONSE:
		case ATT_READ_MULTIPLE_RESPONSE:
		case ATT_READ_BY_GROUP_TYPE_RESPONSE:
		case ATT_WRITE_RESPONSE:
		case ATT_PREPARE_WRITE_RESPONSE:
		case ATT_EXECUTE_WRITE_RESPONSE:
			return true;
		default:
			return false;
	}
}

function validate(test, failMsg) {
	if (!test) {
		throw new Error(failMsg);
	}
}

function fixCallback(obj, callback) {
	validate(!callback || typeof callback === 'function', 'Invalid callback');
	callback = (callback || function() {}).bind(obj);
	return callback;
}

function fixUuid(uuid) {
	if (typeof uuid === 'string' && /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/.test(uuid)) {
		return uuid.toUpperCase();
	}
	if (Number.isInteger(uuid) && uuid >= 0 && uuid <= 0xffff) {
		return getFullUuid(uuid);
	}
	validate(false, 'Invalid uuid (must be a string on the form 00000000-0000-0000-0000-000000000000 or an integer between 0x0000 and 0xffff)');
}

function writeUuid128(buf, uuid, pos) {
	uuid = uuid.replace(/-/g, '');
	for (var i = 30; i >= 0; i -= 2) {
		buf[pos++] = parseInt(uuid.substr(i, 2), 16);
	}
}

function getFullUuid(v) {
	if (v instanceof Buffer && v.length == 2) {
		v = v[0] | (v[1] << 8);
	}
	if (Number.isInteger(v)) {
		return (0x100000000 + v).toString(16).substr(-8).toUpperCase() + BASE_UUID_SECOND_PART;
	} else if (typeof v === 'string') {
		return v.toUpperCase();
	} else if (v instanceof Buffer && v.length == 16) {
		var uuid = Buffer.from(v).reverse().toString('hex').toUpperCase();
		return uuid.substr(0, 8) + '-' + uuid.substr(8, 4) + '-' + uuid.substr(12, 4) + '-' + uuid.substr(16, 4) + '-' + uuid.substr(20, 12);
	}
	return null;
}

function GattServerDb(registerOnConnected1Fn, registerOnConnected2Fn, registerOnDisconnectedFn, registerOnBondedFn, registerAttDbFn) {
	EventEmitter.call(this);
	var gattServerDb = this;
	var allServices = [];
	var attDb = [];
	
	var svccCharacteristic = null;
	var deviceName = 'node-ble';
	var appearanceValue = Buffer.from([0, 0]);
	
	registerOnConnected1Fn(connection => {
		if (!connection.smp.isBonded) {
			return;
		}
		allServices.forEach(s => {
			s.characteristics.forEach(c => {
				c.descriptors.forEach(d => {
					if (d.uuid == fixUuid(0x2902)) {
						var cccdValue = storage.getCccd(
							storage.constructAddress(connection.ownAddressType, connection.ownAddress),
							storage.constructAddress(connection.peerIdentityAddressType, connection.peerIdentityAddress),
							d.handle
						);
						c.cccds[connection.id] = {connection: connection, value: cccdValue};
					}
				});
			});
		});
	});
	
	registerOnConnected2Fn(connection => {
		if (!connection.smp.isBonded) {
			return;
		}
		allServices.forEach(s => {
			s.characteristics.forEach(c => {
				c.descriptors.forEach(d => {
					if (d.uuid == fixUuid(0x2902)) {
						var cccd = c.cccds[connection.id];
						if (cccd && cccd.value) {
							var fn = c.userObj.onSubscriptionChange;
							if (typeof fn === 'function') {
								var notification = !!(cccd.value & 1);
								var indication = !!(cccd.value & 2);
								fn.call(c.userObj, connection, notification, indication, false);
							}
						}
					}
				});
			});
		});
	});
	
	registerOnDisconnectedFn(connection => {
		allServices.forEach(s => {
			s.characteristics.forEach(c => {
				c.descriptors.forEach(d => {
					if (d.uuid == fixUuid(0x2902)) {
						var cccd = c.cccds[connection.id];
						delete c.cccds[connection.id];
						if (cccd && cccd.value) {
							var fn = c.userObj.onSubscriptionChange;
							if (typeof fn === 'function') {
								fn.call(c.userObj, connection, false, false, false);
							}
						}
					}
				});
			});
		});
	});
	
	registerOnBondedFn(connection => {
		allServices.forEach(s => {
			s.characteristics.forEach(c => {
				c.descriptors.forEach(d => {
					if (d.uuid == fixUuid(0x2902)) {
						var cccdValue = c.cccds[connection.id] ? c.cccds[connection.id].value : 0;
						storage.storeCccd(
							storage.constructAddress(connection.ownAddressType, connection.ownAddress),
							storage.constructAddress(connection.peerIdentityAddressType, connection.peerIdentityAddress),
							d.handle,
							cccdValue
						);
					}
				});
			});
		});
	});
	
	registerAttDbFn(attDb);
	
	function addServices(services) {
		validate(Array.isArray(services), 'services must be an array');
		
		var servicesToAdd = [];
		for (var si = 0; si < services.length; si++) {
			servicesToAdd.push({
				userObj: services[si],
				startHandle: null,
				endHandle: null,
				isSecondaryService: false,
				uuid: null,
				includedServices: [],
				characteristics: [],
				numberOfHandles: 1
			});
		}
		for (var si = 0; si < services.length; si++) {
			var service = services[si];
			var s = servicesToAdd[si];
			validate(typeof service === 'object' && service !== null, 'service must be an object');
			s.startHandle = service.startHandle;
			validate((!s.startHandle && s.startHandle !== 0) || (Number.isInteger(s.startHandle) && s.startHandle >= 0x0001 && s.startHandle <= 0xffff), 'Invalid startHandle');
			s.isSecondaryService = !!service.isSecondaryService;
			s.uuid = fixUuid(service.uuid);
			var includedServices = service.includedServices;
			validate(!includedServices || Array.isArray(includedServices), 'includedServices must be an Array if present');
			if (includedServices) {
				for (var i = 0; i < includedServices.length; i++) {
					var ok = false;
					for (var j = 0; j < allServices.length; j++) {
						if (allServices[j].userObj === includedServices[i]) {
							s.includedServices.push({startHandle: allServices[j].startHandle, endHandle: allServices[j].endHandle, uuid: allServices[j].uuid});
							ok = true;
							break;
						}
					}
					if (!ok) {
						for (var j = 0; j < servicesToAdd.length; j++) {
							if (servicesToAdd[j].userObj === includedServices[i]) {
								s.includedServices.push(j);
								ok = true;
								break;
							}
						}
					}
					validate(ok, 'All objects in the includedServices array must refer to a service already added or one that is being added');
					++s.numberOfHandles;
				}
			}
			var characteristics = service.characteristics;
			validate(!characteristics || Array.isArray(characteristics), 'characteristics must be an Array if present');
			if (characteristics) {
				for (var i = 0; i < characteristics.length; i++) {
					var characteristic = characteristics[i];
					validate(typeof characteristic === 'object' && characteristic !== null, 'characteristic must be an object');
					var c = {
						userObj: characteristic,
						startHandle: null,
						endHandle: null,
						uuid: fixUuid(characteristic.uuid),
						descriptors: [],
						properties: 0,
						maxLength: 512,
						readPerm: 'open',
						writePerm: 'open'
					};
					s.characteristics.push(c);
					s.numberOfHandles += 2;
					
					var properties = characteristic.properties;
					validate(!properties || Array.isArray(properties), 'properties must be an Array if present');
					if (properties) {
						for (var j = 0; j < properties.length; j++) {
							var index = ['broadcast', 'read', 'write-without-response', 'write', 'notify', 'indicate', 'authenticated-signed-writes', 'reliable-write', 'writable-auxiliaries'].indexOf(properties[j]);
							validate(index >= 0 && index != 6, 'A characteristic property is not valid');
							c.properties |= (1 << index);
						}
					}
					
					var maxLength = characteristic.maxLength;
					validate(typeof maxLength === 'undefined' || (Number.isInteger(maxLength) && maxLength >= 0 && maxLength <= 512), 'Invalid maxLength');
					if (!(typeof maxLength === 'undefined')) {
						c.maxLength = maxLength;
					}
					
					var permTypes = ['not-permitted', 'open', 'encrypted', 'encrypted-mitm', 'encrypted-mitm-sc', 'custom'];
					var readPerm = characteristic.readPerm;
					if (readPerm) {
						validate(permTypes.some(t => t === readPerm), 'Invalid readPerm');
						validate((readPerm != 'not-permitted') == !!(c.properties & 0x02), 'Invalid characteristic permission configuration for the read property.');
						c.readPerm = readPerm;
					} else {
						if (!(c.properties & 0x02)) {
							c.readPerm = 'not-permitted';
						}
					}
					var writePerm = characteristic.writePerm;
					if (writePerm) {
						validate(permTypes.some(t => t === writePerm), 'Invalid writePerm');
						validate((writePerm != 'not-permitted') == !!(c.properties & 0x8c), 'Invalid characteristic permission configuration for the write/write-without-response/reliable-write property.');
						c.writePerm = writePerm;
					} else {
						if (!(c.properties & 0x8c)) {
							c.writePerm = 'not-permitted';
						}
					}
					
					var descriptors = characteristic.descriptors;
					validate(!descriptors || Array.isArray(descriptors), 'descriptors must be an Array if present');
					if (descriptors) {
						for (var j = 0; j < descriptors.length; j++) {
							var descriptor = descriptors[j];
							var d = {
								userObj: descriptor,
								handle: null,
								uuid: fixUuid(descriptor.uuid),
								maxLength: 512,
								readPerm: 'open',
								writePerm: 'open'
							};
							c.descriptors.push(d);
							
							maxLength = descriptor.maxLength;
							validate(typeof maxLength === 'undefined' || (Number.isInteger(maxLength) && maxLength >= 0 && maxLength <= 512), 'Invalid maxLength');
							if (!(typeof maxLength === 'undefined')) {
								d.maxLength = maxLength;
							}
							
							readPerm = descriptor.readPerm;
							if (readPerm) {
								validate(permTypes.some(t => t === readPerm), 'Invalid readPerm');
								d.readPerm = readPerm;
							}
							writePerm = descriptor.writePerm;
							if (writePerm) {
								validate(permTypes.some(t => t === writePerm), 'Invalid writePerm');
								d.writePerm = writePerm;
							}
							++s.numberOfHandles;
						}
					}
					
					// Add ccc descriptor and extended properties descriptor, if needed
					if (c.properties & (3 << 4)) {
						if (!c.descriptors.some(d => d.uuid == fixUuid(0x2902))) {
							c.descriptors.push({
								userObj: Object.create(null),
								handle: null,
								uuid: fixUuid(0x2902),
								maxLength: 2,
								readPerm: 'open',
								writePerm: 'open'
							});
							++s.numberOfHandles;
						}
					}
					validate(!c.descriptors.some(d => d.uuid == fixUuid(0x2900)), 'The Characteristic Extended Properties descriptor is created automatically if needed and cannot be created manually')
					if (c.properties >> 7) {
						c.descriptors.push({
							userObj: {
								onRead: null,
								value: c.properties >> 7
							},
							handle: null,
							uuid: fixUuid(0x2900),
							maxLength: 2,
							readPerm: 'open',
							writePerm: 'not-permitted'
						});
						++s.numberOfHandles;
					}
					
					var cccdFound = false;
					for (var j = 0; j < c.descriptors.length; j++) {
						var d = c.descriptors[j];
						if (d.uuid == fixUuid(0x2902)) {
							validate(!cccdFound, 'Can only have one Client Characteristic Configuration descriptor per characteristic');
							cccdFound = true;
							c.cccds = Object.create(null);
						}
					}
				}
			}
		}
		var insertPositions = [];
		for (var si = 0; si < services.length; si++) {
			var s = servicesToAdd[si];
			var chosenStartHandle = 0x0000;
			var chosenPosition;
			var lastHandle = 0x0000;
			
			allServices.push({startHandle: 0xffff});
			for (var i = 0; i < allServices.length; i++) {
				if (allServices[i].startHandle - lastHandle - 1 >= s.numberOfHandles) {
					if (chosenStartHandle == 0x0000) {
						chosenStartHandle = lastHandle + 1;
						chosenPosition = i;
					}
					if (s.startHandle && lastHandle + 1 <= s.startHandle && s.startHandle + s.numberOfHandles <= allServices[i].startHandle) {
						chosenStartHandle = s.startHandle;
						chosenPosition = i;
						break;
					}
				}
				lastHandle = allServices[i].endHandle;
			}
			allServices.pop();
			if (chosenStartHandle) {
				s.startHandle = chosenStartHandle;
				s.endHandle = chosenStartHandle + s.numberOfHandles - 1;
				allServices.splice(chosenPosition, 0, s);
				insertPositions.push(chosenPosition);
			} else {
				while (insertPositions.length != 0) {
					allServices.splice(insertPositions.pop(), 1);
				}
				throw new Error('No space for these services in the db');
			}
		}
		for (var si = 0; si < services.length; si++) {
			var s = servicesToAdd[si];
			
			var handle = s.startHandle;
			
			// Service Declaration
			addAttribute(handle++, s.endHandle, !s.isSecondaryService ? 0x2800 : 0x2801, serializeUuid(s.uuid), 512, 'open', 'not-permitted');
			
			for (var i = 0; i < s.includedServices.length; i++) {
				if (Number.isInteger(s.includedServices[i])) {
					var s2 = servicesToAdd[s.includedServices[i]];
					s.includedServices[i] = {startHandle: s2.startHandle, endHandle: s2.endHandle, uuid: s2.uuid};
				}
				
				// Include Declaration
				var uuid = serializeUuid(s.includedServices[i]);
				var val = Buffer.alloc(4 + (uuid.length == 2 ? 2 : 0));
				val.writeUInt16LE(s.includedServices[i].startHandle, 0);
				val.writeUInt16LE(s.includedServices[i].endHandle, 2);
				if (uuid.length == 2) {
					uuid.copy(val, 4);
				}
				addAttribute(handle++, undefined, 0x2802, val, 512, 'open', 'not-permitted');
			}
			
			s.characteristics.forEach(c => {
				c.startHandle = handle++;
				
				// Characteristic Declaration
				var uuid = serializeUuid(c.uuid);
				var val = Buffer.alloc(3 + uuid.length);
				val[0] = (c.properties & 0xff) | ((c.properties >> 1) & 0x80); // If any extended property, set the extended properties flag
				val.writeUInt16LE(handle, 1);
				uuid.copy(val, 3);
				addAttribute(c.startHandle, c.startHandle + 1 + c.descriptors.length, 0x2803, val, 512, 'open', 'not-permitted');
				
				function createReadFn(obj, isCccd) {
					return function(connection, opcode, offset, callback) {
						if (isCccd) {
							var value = Buffer.from([c.cccds[connection.id] ? c.cccds[connection.id].value : 0, 0]);
							callback(0, value.slice(offset));
							return;
						}
						
						
						if (obj.readPerm == 'custom') {
							var authorizeFn = obj.userObj.onAuthorizeRead;
							validate(typeof authorizeFn === 'function', 'The readPerm is custom, but no onAuthorizeRead function exists');
							var usedAuthorizeCallback = false;
							authorizeFn.call(obj.userObj, connection, function(err) {
								if (usedAuthorizeCallback) {
									return;
								}
								err = err || 0;
								validate(Number.isInteger(err) && err >= 0 && err <= 0xff, 'Invalid error code');
								usedAuthorizeCallback = true;
								if (!connection.disconnected) {
									if (err) {
										callback(err);
									} else {
										cont();
									}
								}
							});
							return;
						}
						
						cont();
						function cont() {
							var fn = obj.userObj.onPartialRead;
							if (typeof fn === 'function') {
								var usedCallback = false;
								fn.call(obj.userObj, connection, offset, function(err, value) {
									if (usedCallback) {
										return;
									}
									err = err || 0;
									validate(Number.isInteger(err) && err >= 0 && err <= 0xff, 'Invalid error code');
									if (!err) {
										if (typeof value === 'string') {
											value = Buffer.from(value);
										}
										validate(value instanceof Buffer, 'Invalid attribute value');
										validate(offset + value.length <= obj.maxLength, 'The supplied value exceeds the maximum length for this value');
									}
									usedCallback = true;
									callback(err, err ? null : value);
								});
								return;
							}
							
							fn = obj.userObj.onRead;
							if (typeof fn === 'function') {
								var usedCallback = false;
								fn.call(obj.userObj, connection, function(err, value) {
									if (usedCallback) {
										return;
									}
									err = err || 0;
									validate(Number.isInteger(err) && err >= 0 && err <= 0xff, 'Invalid error code');
									if (!err) {
										if (typeof value === 'string') {
											value = Buffer.from(value);
										}
										validate(value instanceof Buffer, 'Invalid attribute value');
										validate(value.length <= obj.maxLength, 'The supplied value exceeds the maximum length for this value');
										if (offset > value.length) {
											err = AttErrors.INVALID_OFFSET;
										}
										value = value.slice(offset);
									}
									usedCallback = true;
									callback(err, err ? null : value);
								});
								return;
							}
							
							var value = obj.userObj.value;
							if (typeof value === 'string') {
								value = Buffer.from(value);
							}
							if (!(value instanceof Buffer)) {
								// Can't throw here, so just set it to empty buffer
								value = Buffer.alloc(0);
							}
							value = value.slice(0, obj.maxLength);
							offset > value.length ? callback(AttErrors.INVALID_OFFSET) : callback(0, value.slice(offset));
						}
					};
				}
				
				function createWriteFn(obj, isCccd) {
					return function(connection, opcode, offset, value, callback) {
						if (isCccd) {
							if (offset > 2) {
								callback(AttErrors.INVALID_OFFSET);
								return;
							}
							if (offset + value.length != 2) {
								callback(AttErrors.INVALID_ATTRIBUTE_VALUE_LENGTH);
								return;
							}
							var prev = Buffer.from([c.cccds[connection.id] ? c.cccds[connection.id].value : 0, 0]);
							var v = Buffer.concat([prev.slice(0, offset), value]);
							
							var notification = !!(v[0] & 1);
							var indication = !!(v[0] & 2);
							
							if ((notification && !(c.properties & 0x10)) || (indication && !(c.properties & 0x20)) || v[1] != 0 || v[0] > 3) {
								callback(AttErrors.CLIENT_CHARACTERISTIC_CONFIGURATION_DESCRIPTOR_IMPROPERLY_CONFIGURED);
								return;
							}
							
							if (!c.cccds[connection.id]) {
								c.cccds[connection.id] = {connection: connection, value: v[0]};
							} else {
								c.cccds[connection.id].value = v[0];
							}
							
							if (connection.smp.isBonded && !prev.equals(v)) {
								storage.storeCccd(
									storage.constructAddress(connection.ownAddressType, connection.ownAddress),
									storage.constructAddress(connection.peerIdentityAddressType, connection.peerIdentityAddress),
									obj.handle,
									v[0]
								);
							}
							
							callback(0);
							
							var fn = c.userObj.onSubscriptionChange;
							if (typeof fn === 'function') {
								fn.call(c.userObj, connection, notification, indication, true);
							}
							return;
						}
						if (offset > obj.maxLength) {
							callback(AttErrors.INVALID_OFFSET);
							return;
						}
						if (offset + value.length > obj.maxLength) {
							callback(AttErrors.INVALID_ATTRIBUTE_VALUE_LENGTH);
							return;
						}
						
						var fn = obj.userObj.onPartialWrite;
						if (typeof fn === 'function') {
							var usedCallback = false;
							fn.call(obj.userObj, connection, opcode != ATT_WRITE_COMMAND, offset, value, function(err) {
								if (usedCallback) {
									return;
								}
								err = err || 0;
								validate(Number.isInteger(err) && err >= 0 && err <= 0xff, 'Invalid error code');
								usedCallback = true;
								callback(err);
							});
							return;
						}
						fn = obj.userObj.onWrite;
						if (typeof fn === 'function') {
							if (offset == 0) {
								var usedCallback = false;
								fn.call(obj.userObj, connection, opcode != ATT_WRITE_COMMAND, value, function(err) {
									if (usedCallback) {
										return;
									}
									err = err || 0;
									validate(Number.isInteger(err) && err >= 0 && err <= 0xff, 'Invalid error code');
									usedCallback = true;
									callback(err);
								});
							} else {
								callback(AttErrors.INVALID_OFFSET);
							}
							return;
						}
						var v = obj.userObj.value;
						var isString = typeof v === 'string';
						if (offset != 0) {
							if (isString) {
								v = Buffer.from(v);
							}
							if (offset > v.length) {
								callback(AttErrors.INVALID_OFFSET);
								return;
							}
							value = Buffer.concat([v.slice(0, offset), value]);
						}
						obj.userObj.value = isString ? value.toString() : value;
						callback(0);
					};
				}
				
				function createAuthorizeWriteFn(obj) {
					return function(connection, opcode, offset, value, callback) {
						if (obj.writePerm != 'custom') {
							callback(0);
						} else {
							var fn = obj.userObj.onAuthorizeWrite;
							validate(typeof fn === 'function', 'The writePerm is custom, but no onAuthorizeWrite function exists');
							fn.call(obj.userObj, connection, function(err) {
								err = err || 0;
								validate(Number.isInteger(err) && err >= 0 && err <= 0xff, 'Invalid error code');
								callback(err);
							});
						}
					};
				}
				
				// Characteristic Value declaration
				addAttribute(handle++, undefined, c.uuid, undefined, c.maxLength, c.readPerm, c.writePerm, createReadFn(c), createWriteFn(c), createAuthorizeWriteFn(c));
				
				c.descriptors.forEach(d => {
					d.handle = handle;
					
					var isCccd = d.uuid == fixUuid(0x2902);
					
					// Characteristic descriptor declaration
					addAttribute(handle++, undefined, d.uuid, undefined, d.maxLength, d.readPerm, d.writePerm, createReadFn(d, isCccd), createWriteFn(d, isCccd), createAuthorizeWriteFn(d));
					
					if (isCccd) {
						var getActiveSubscribers = function() {
							var res = [];
							for (var id in c.cccds) {
								var subscriber = c.cccds[id];
								if (subscriber.value) {
									res.push({connection: subscriber.connection, value: subscriber.value});
								}
							}
							return res;
						};
						
						function validateBuffer(value) {
							if (typeof value === 'string') {
								value = Buffer.from(value);
							}
							validate(value instanceof Buffer, 'Invalid value');
							return value;
						}
						
						c.userObj.notifyAll = function(value) {
							value = validateBuffer(value);
							getActiveSubscribers().forEach(s => {
								if (s.value & 1) {
									s.connection.gatt._notify(c.startHandle + 1, value, function() {}, function() {});
								}
							});
						};
						
						c.userObj.indicateAll = function(value) {
							value = validateBuffer(value);
							getActiveSubscribers().forEach(s => {
								if (s.value & 2) {
									s.connection.gatt._indicate(c.startHandle + 1, value, function() {});
								}
							});
						};
						
						c.userObj.notify = function(connection, value, sentCallback, completeCallback) {
							value = validateBuffer(value);
							validate(!sentCallback || typeof sentCallback === 'function', 'Invalid sentCallback');
							validate(!completeCallback || typeof completeCallback === 'function', 'Invalid completeCallback');
							if (sentCallback) {
								sentCallback = sentCallback.bind(c.userObj);
							}
							if (completeCallback) {
								completeCallback = completeCallback.bind(c.userObj);
							}
							
							var subscriber = c.cccds[connection.id];
							if (!subscriber || !(subscriber.value & 1)) {
								return false;
							}
							subscriber.connection.gatt._notify(c.startHandle + 1, value, sentCallback || function() {}, completeCallback || function() {});
							return true;
						};
						
						c.userObj.indicate = function(connection, value, callback) {
							value = validateBuffer(value);
							validate(!callback || typeof callback === 'function', 'Invalid callback');
							if (callback) {
								callback = callback.bind(c.userObj);
							}
							
							var subscriber = c.cccds[connection.id];
							if (!subscriber || !(subscriber.value & 2)) {
								return false;
							}
							subscriber.connection.gatt._indicate(c.startHandle + 1, value, callback || function() {});
							return true;
						};
					}
				});
				
				c.endHandle = handle - 1;
			});
		}
		for (var si = 0; si < services.length; si++) {
			var s = servicesToAdd[si];
			s.userObj.startHandle = s.startHandle;
			s.userObj.endHandle = s.endHandle;
		}
	}
	
	function addAttribute(handle, groupEndHandle, uuid, value, maxLength, readPerm, writePerm, readFn, writeFn, authorizeWriteFn) {
		//console.log('Inserting ', handle, groupEndHandle, uuid);
		uuid = getFullUuid(uuid);
		attDb[handle] = {
			groupEndHandle: groupEndHandle,
			uuid16: (uuid.substr(8) == BASE_UUID_SECOND_PART && uuid.substr(0, 4) == '0000') ? parseInt(uuid, 16) : null,
			uuid: uuid,
			value: value,
			maxLength: maxLength,
			readPerm: readPerm,
			writePerm: writePerm,
			read: readFn || function(connection, opcode, offset, callback) { offset > value.length ? callback(AttErrors.INVALID_OFFSET) : callback(0, value.slice(offset)); },
			write: writeFn,
			authorizeWrite: authorizeWriteFn
		};
	}
	
	this.setDeviceName = function(name) {
		validate(typeof name === 'string' || name instanceof Buffer, 'The name must be a string or a Buffer');
		var buf = Buffer.from(name);
		validate(buf.length <= 248, 'Name is too long. It may be up to 248 bytes.');
		deviceName = typeof name === 'string' ? name : buf;
	};
	
	this.setAppearance = function(appearance) {
		validate(Number.isInteger(appearance) && appearance >= 0 && appearance <= 0xffff, 'Appearance must be a 16-bit integer');
		appearanceValue = Buffer.from([appearance, appearance >> 8]);
	};
	
	this.getSvccCharacteristic = function() {
		return svccCharacteristic;
	};
	
	this.addServices = function(services) {
		addServices(services);
		//console.log(attDb);
	};
	
	this.removeService = function(service) {
		for (var i = 0; i < allServices.length; i++) {
			if (allServices[i].userObj === service) {
				var s = allServices[i];
				allServices.splice(i, 1);
				for (var handle = s.startHandle; handle <= s.endHandle; handle++) {
					delete attDb[handle];
				}
				if (attDb.length == s.endHandle + 1) {
					var handle;
					for (handle = s.startHandle - 1; handle >= 1; --handle) {
						if (attDb[handle]) {
							break;
						}
					}
					attDb.length = handle + 1;
				}
				return true;
			}
		}
		return false;
	};
	
	addServices([
		{
			isSecondaryService: false,
			uuid: 0x1801,
			includedServices: [],
			characteristics: [svccCharacteristic = {
				uuid: 0x2a05,
				maxLength: 4,
				properties: ['indicate'],
				readPerm: 'not-permitted',
				writePerm: 'not-permitted',
				onSubscriptionChange: function(connection, notification, indication, isWrite) {
					
				},
				descriptors: []
			}]
		},
		{
			isSecondaryService: false,
			uuid: 0x1800,
			includedServices: [],
			characteristics: [
				{
					uuid: 0x2a00,
					properties: ['read'],
					readPerm: 'open',
					writePerm: 'not-permitted',
					onRead: function(connection, callback) {
						callback(0, deviceName);
					},
					maxLength: 248,
					descriptors: []
				},
				{
					uuid: 0x2a01,
					properties: ['read'],
					readPerm: 'open',
					writePerm: 'not-permitted',
					onRead: function(connection, callback) {
						callback(0, appearanceValue);
					},
					maxLength: 2,
					descriptors: []
				}
			]
		}
	]);
}
util.inherits(GattServerDb, EventEmitter);

function AttConnection(attDb, connection, registerOnDataFn, sendDataFn, notifyIndicateCallback, timeoutCallback) {
	// attDb: [{uuid16, uuid128, groupEndHandle, value, maxLength, read(connection, opcode, offset, function(err, value)),
	// write(connection, opcode, offset, value, function(err)), authorizeWrite(connection, opcode, offset, value, function(err)}]
	
	var currentMtu = 23;
	var timedout = false;
	
	// Client
	var requestQueue = new Queue(); // {data, callback}
	var currentOutgoingRequest = null; // {responseOpcode, callback}
	var currentOutgoingRequestIsSent;
	var hasOutgoingConfirmation = false;
	var requestTimeoutClearFn = function() {};
	
	// Server
	var isHandlingRequest = false;
	var indicationQueue = new Queue(); // {data, callback}
	var currentOutgoingIndication = null; // callback
	var currentOutgoingIndicationIsSent;
	var indicationTimeoutClearFn = null;
	var prepareWriteQueue = []; // Array of {item, handle, offset, data}
	var prepareWriteQueueSize = 0; // Number of requests
	var notificationQueue = new Queue(); // {data, sentCallback, completeCallback}
	
	function attTimeout() {
		if (!timedout) {
			timedout = true;
			sendDataFn = function() {};
			timeoutCallback();
		}
	}
	
	function sendNextRequest() {
		if (currentOutgoingRequest == null) {
			var next = requestQueue.shift();
			if (next) {
				requestTimeoutClearFn = connection.setTimeout(attTimeout, 30000);
				currentOutgoingRequest = {responseOpcode: next.data[0] + 1, callback: next.callback};
				currentOutgoingRequestIsSent = false;
				sendDataFn(next.data.slice(0, currentMtu), function() {
					currentOutgoingRequestIsSent = true;
				});
			}
		}
	}
	
	function sendResponse(buffer) {
		isHandlingRequest = true;
		sendDataFn(buffer, function() {
			isHandlingRequest = false;
		});
	}
	
	function sendErrorResponse(opcode, handle, errorCode) {
		var buffer = Buffer.alloc(5);
		buffer[0] = ATT_ERROR_RESPONSE;
		buffer[1] = opcode;
		buffer.writeUInt16LE(handle, 2);
		buffer[4] = errorCode;
		sendResponse(buffer);
	}
	
	function sendNextIndication() {
		if (currentOutgoingIndication == null && (currentOutgoingRequest == null || currentOutgoingRequest.responseOpcode != ATT_EXCHANGE_MTU_RESPONSE)) {
			var next = indicationQueue.shift();
			if (next) {
				indicationTimeoutClearFn = connection.setTimeout(attTimeout, 30000);
				currentOutgoingIndication = next.callback;
				currentOutgoingIndicationIsSent = false;
				sendDataFn(next.data.slice(0, currentMtu), function() {
					currentOutgoingIndicationIsSent = true;
				});
			}
		}
	}
	
	function sendConfirmation() {
		hasOutgoingConfirmation = true;
		sendDataFn(Buffer.from([ATT_HANDLE_VALUE_CONFIRMATION]), function() {
			hasOutgoingConfirmation = false;
		});
	}
	
	function checkPerm(perm, isWrite) {
		switch (perm) {
			case 'not-permitted': return isWrite ? AttErrors.WRITE_NOT_PERMITTED : AttErrors.READ_NOT_PERMITTED;
			case 'open': return 0;
			case 'custom': return 0;
		}
		if (!connection.smp.isEncrypted) {
			return connection.smp.hasLtk ? AttErrors.INSUFFICIENT_ENCRYPTION : AttErrors.INSUFFICIENT_AUTHENTICATION;
		}
		var level = connection.smp.currentEncryptionLevel;
		switch (perm) {
			case 'encrypted': return 0;
			case 'encrypted-mitm': return level.mitm ? 0 : AttErrors.INSUFFICIENT_AUTHENTICATION;
			case 'encrypted-mitm-sc': return level.mitm && level.sc ? 0 : AttErrors.INSUFFICIENT_AUTHENTICATION;
		}
	}
	
	function checkReadPermission(item) {
		return checkPerm(item.readPerm, false);
	}
	
	function checkWritePermission(item) {
		return checkPerm(item.writePerm, true);
	}
	
	registerOnDataFn(data => {
		if (timedout) {
			return;
		}
		if (data.length == 0) {
			// Drop. We can't send Error Response since that needs Request Opcode In Error.
			return;
		}
		if (data.length > currentMtu) {
			// Drop, since this is illegal
			return;
		}
		var opcode = data[0];
		//console.log('handling ' + opcode);
		
		if (currentOutgoingRequest != null && currentOutgoingRequestIsSent && (opcode == currentOutgoingRequest.responseOpcode || opcode == ATT_ERROR_RESPONSE)) {
			var cb = currentOutgoingRequest.callback;
			if (opcode == ATT_ERROR_RESPONSE && data.length != 5) {
				// Drop invalid PDU
				return;
			}
			if (cb) {
				if (opcode == ATT_ERROR_RESPONSE && data[4] == 0) {
					// Error code 0 is invalid and not reserved for future use.
					// But it should still be considered an error, so use the Unlikely Error code to get a non-zero code.
					data[4] = AttErrors.UNLIKELY_ERROR;
				}
				var err = opcode == ATT_ERROR_RESPONSE ? data[4] : 0;
				//console.log('executing cb ' + err);
				if (!cb(err, data)) {
					// Drop invalid PDU
					return;
				}
			}
			requestTimeoutClearFn();
			var wasMtuExchange = currentOutgoingRequest.responseOpcode == ATT_EXCHANGE_MTU_RESPONSE;
			currentOutgoingRequest = null;
			if (wasMtuExchange) {
				while (notificationQueue.getLength() != 0) {
					var item = notificationQueue.shift();
					sendDataFn(item.data.slice(0, currentMtu), item.sentCallback, item.completeCallback);
				}
				sendNextIndication();
			}
			sendNextRequest();
			return;
		}
		
		if (isKnownResponseOpcode(opcode)) {
			// Sending unexpected response packet
			return;
		}
		
		if (isHandlingRequest && isKnownRequestOpcode(opcode)) {
			// Client must wait for the response before it sends a new request
			return;
		}
		
		switch (opcode) {
			case ATT_EXCHANGE_MTU_REQUEST:
				if (data.length != 3) {
					sendErrorResponse(opcode, 0, AttErrors.INVALID_PDU);
					return;
				}
				var clientRxMTU = data.readUInt16LE(1);
				if (clientRxMTU < 23) {
					clientRxMTU = 23;
				}
				var serverRxMTU = 517;
				var combinedMTU = Math.min(clientRxMTU, serverRxMTU);
				sendResponse(Buffer.from([ATT_EXCHANGE_MTU_RESPONSE, serverRxMTU, serverRxMTU >> 8]));
				var newMTU = Math.min(clientRxMTU, serverRxMTU);
				if (currentMtu == 23 && newMTU != 23) {
					currentMtu = newMTU;
				}
				return;
			case ATT_FIND_INFORMATION_REQUEST:
				if (data.length != 5) {
					sendErrorResponse(opcode, 0, AttErrors.INVALID_PDU);
					return;
				}
				var startingHandle = data.readUInt16LE(1);
				var endingHandle = data.readUInt16LE(3);
				if (startingHandle == 0 || startingHandle > endingHandle) {
					sendErrorResponse(opcode, startingHandle, AttErrors.INVALID_HANDLE);
					return;
				}
				endingHandle = Math.min(endingHandle, attDb.length - 1);
				var max16 = (currentMtu - 2) / 2 >>> 0;
				var max128 = (currentMtu - 2) / 16 >>> 0;
				var format = 0;
				var list = [];
				for (var i = startingHandle; i <= endingHandle; i++) {
					var item = attDb[i];
					if (item) {
						if (item.uuid16 != null) {
							if (format == 2 || list.length == max16) {
								break;
							}
							format = 1;
							list.push({handle: i, uuid16: item.uuid16});
						} else {
							if (format == 1 || list.length == max128) {
								break;
							}
							format = 2;
							list.push({handle: i, uuid: item.uuid});
						}
					}
				}
				if (format == 0) {
					sendErrorResponse(opcode, startingHandle, AttErrors.ATTRIBUTE_NOT_FOUND);
					return;
				}
				var ret = Buffer.alloc(2 + (format == 1 ? 4 : 18) * list.length);
				ret[0] = ATT_FIND_INFORMATION_RESPONSE;
				ret[1] = format;
				var pos = 2;
				list.forEach(v => {
					ret.writeUInt16LE(v.handle, pos);
					pos += 2;
					if (format == 1) {
						ret.writeUInt16LE(v.uuid16, pos);
						pos += 2;
					} else {
						writeUuid128(ret, v.uuid, pos);
						pos += 16;
					}
				});
				sendResponse(ret);
				return;
			case ATT_FIND_BY_TYPE_VALUE_REQUEST:
				if (data.length < 7) {
					sendErrorResponse(opcode, 0, AttErrors.INVALID_PDU);
					return;
				}
				var startingHandle = data.readUInt16LE(1);
				var endingHandle = data.readUInt16LE(3);
				var attributeType = data.readUInt16LE(5);
				var attributeValue = data.slice(7);
				if (startingHandle == 0 || startingHandle > endingHandle) {
					sendErrorResponse(opcode, startingHandle, AttErrors.INVALID_HANDLE);
					return;
				}
				endingHandle = Math.min(endingHandle, attDb.length - 1);
				var max = (currentMtu - 1) / 4 >>> 0;
				var list = [];
				var nextFn = function(i) {
					for (; i <= endingHandle; i++) {
						var item = attDb[i];
						if (item && item.uuid16 === attributeType) {
							var perm = checkReadPermission(item);
							if (perm == 0) {
								item.read(connection, opcode, 0, function(err, value) {
									if (err == 0 && attributeValue.equals(value)) {
										list.push({start: i, end: item.groupEndHandle || i});
										if (list.length == max) {
											doneFn();
											return;
										}
									}
									nextFn(i + 1);
								});
								return;
							}
						}
					}
					doneFn();
				};
				var doneFn = function() {
					if (list.length == 0) {
						sendErrorResponse(opcode, startingHandle, AttErrors.ATTRIBUTE_NOT_FOUND);
					} else {
						var ret = Buffer.alloc(1 + list.length * 4);
						ret[0] = ATT_FIND_BY_TYPE_VALUE_RESPONSE;
						var pos = 1;
						list.forEach(v => {
							ret.writeUInt16LE(v.start, pos);
							ret.writeUInt16LE(v.end, pos + 2);
							pos += 4;
						});
						sendResponse(ret);
					}
				};
				isHandlingRequest = true;
				nextFn(startingHandle);
				return;
			case ATT_READ_BY_TYPE_REQUEST:
				if (data.length != 7 && data.length != 21) {
					sendErrorResponse(opcode, 0, AttErrors.INVALID_PDU);
					return;
				}
				var startingHandle = data.readUInt16LE(1);
				var endingHandle = data.readUInt16LE(3);
				var attributeType = getFullUuid(data.length == 7 ? data.readUInt16LE(5) : data.slice(5));
				if (startingHandle == 0 || startingHandle > endingHandle) {
					sendErrorResponse(opcode, startingHandle, AttErrors.INVALID_HANDLE);
					return;
				}
				endingHandle = Math.min(endingHandle, attDb.length - 1);
				var requestMtu = currentMtu;
				var list = [];
				var lastErr = 0;
				var errorHandle;
				var nextFn = function(i) {
					for (; i <= endingHandle; i++) {
						var item = attDb[i];
						if (item && item.uuid == attributeType) {
							var perm = checkReadPermission(item);
							if (perm != 0) {
								lastErr = perm;
								errorHandle = i;
								break;
							} else {
								item.read(connection, opcode, 0, function(err, value) {
									if (value) {
										value = value.slice(0, Math.min(253, requestMtu - 4));
									}
									if (err != 0) {
										lastErr = err;
										errorHandle = i;
										doneFn();
									} else if ((list.length == 0 || list[0].value.length == value.length) && 2 + (2 + value.length) * (list.length + 1) <= requestMtu) {
										list.push({handle: i, value: Buffer.from(value)});
										nextFn(i + 1);
									} else {
										doneFn();
									}
								});
								return;
							}
						}
					}
					doneFn();
				};
				var doneFn = function() {
					if (lastErr != 0) {
						sendErrorResponse(opcode, errorHandle, lastErr);
					} else if (list.length == 0) {
						sendErrorResponse(opcode, startingHandle, AttErrors.ATTRIBUTE_NOT_FOUND);
					} else {
						var ret = Buffer.alloc(2 + (2 + list[0].value.length) * list.length);
						ret[0] = ATT_READ_BY_TYPE_RESPONSE;
						ret[1] = 2 + list[0].value.length;
						var pos = 2;
						list.forEach(v => {
							ret.writeUInt16LE(v.handle, pos);
							v.value.copy(ret, pos + 2);
							pos += 2 + v.value.length;
						});
						sendResponse(ret);
					}
				};
				isHandlingRequest = true;
				nextFn(startingHandle);
				return;
			case ATT_READ_REQUEST:
				if (data.length != 3) {
					sendErrorResponse(opcode, 0, AttErrors.INVALID_PDU);
					return;
				}
				var handle = data.readUInt16LE(1);
				var item = attDb[handle];
				if (!item) {
					sendErrorResponse(opcode, handle, AttErrors.INVALID_HANDLE);
					return;
				}
				var perm = checkReadPermission(item);
				if (perm != 0) {
					sendErrorResponse(opcode, handle, perm);
					return;
				}
				var requestMtu = currentMtu;
				isHandlingRequest = true;
				item.read(connection, opcode, 0, function(err, value) {
					if (err != 0) {
						sendErrorResponse(opcode, handle, err);
					} else {
						if (value) {
							value = value.slice(0, requestMtu - 1);
						}
						var ret = Buffer.alloc(1 + value.length);
						ret[0] = ATT_READ_RESPONSE;
						value.copy(ret, 1);
						sendResponse(ret);
					}
				});
				return;
			case ATT_READ_BLOB_REQUEST:
				if (data.length != 5) {
					sendErrorResponse(opcode, 0, AttErrors.INVALID_PDU);
					return;
				}
				var handle = data.readUInt16LE(1);
				var offset = data.readUInt16LE(3);
				var item = attDb[handle];
				if (!item) {
					sendErrorResponse(opcode, handle, AttErrors.INVALID_HANDLE);
					return;
				}
				var perm = checkReadPermission(item);
				if (perm != 0) {
					sendErrorResponse(opcode, handle, perm);
					return;
				}
				var requestMtu = currentMtu;
				isHandlingRequest = true;
				item.read(connection, opcode, offset, function(err, value) {
					if (err != 0) {
						sendErrorResponse(opcode, handle, err);
					} else {
						if (value) {
							value = value.slice(0, requestMtu - 1);
						}
						var ret = Buffer.alloc(1 + value.length);
						ret[0] = ATT_READ_BLOB_RESPONSE;
						value.copy(ret, 1);
						sendResponse(ret);
					}
				});
				return;
			case ATT_READ_MULTIPLE_REQUEST:
				if (data.length < 5 || (data.length - 1) % 2 != 0) {
					sendErrorResponse(opcode, 0, AttErrors.INVALID_PDU);
					return;
				}
				var handles = [];
				for (var i = 1; i < data.length; i += 2) {
					var handle = data.readUInt16LE(i);
					handles.push(handle);
					var item = attDb[handle];
					if (!item) {
						sendErrorResponse(opcode, handle, AttErrors.INVALID_HANDLE);
						return;
					}
				}
				var requestMtu = currentMtu;
				var list = [];
				var nextFn = function(i) {
					for (; i < handles.length; i++) {
						var handle = handles[i];
						var item = attDb[handle];
						if (!item) {
							// If att db changes while processing
							sendErrorResponse(opcode, handle, AttErrors.INVALID_HANDLE);
							return;
						}
						var perm = checkReadPermission(item);
						if (perm != 0) {
							list.push({err: perm, handle: handle});
						} else {
							item.read(connection, opcode, 0, function(err, value) {
								if (err != 0) {
									list.push({err: err, handle: handle});
								} else {
									if (value) {
										value = value.slice(0, requestMtu - 1);
									}
									list.push({err: 0, value: Buffer.from(value)});
								}
								nextFn(i + 1);
							});
							return;
						}
					}
					var buffers = Buffer.from([ATT_READ_MULTIPLE_RESPONSE]);
					var firstAuthz = 0, firstAuth = 0, firstEncKeySize = 0, firstEnc = 0, firstReadNotPerm = 0, firstOther = 0, otherErrorType;
					list.forEach(v => {
						if (v.err != 0) {
							if (firstAuthz == 0 && v.err == AttErrors.INSUFFICIENT_AUTHORIZATION) {
								firstAuthz = v.handle;
							}
							if (firstAuth == 0 && v.err == AttErrors.INSUFFICIENT_AUTHENTICATION) {
								firstAuth = v.handle;
							}
							if (firstEncKeySize == 0 && v.err == AttErrors.INSUFFICIENT_ENCRYPTION_KEY_SIZE) {
								firstEncKeySize = v.handle;
							}
							if (firstEnc == 0 && v.err == AttErrors.INSUFFICIENT_ENCRYPTION) {
								firstEnc = v.handle;
							}
							if (firstOther == 0) {
								firstOther = v.handle;
								otherErrorType = v.err;
							}
						} else {
							buffers.push(v.value);
						}
					});
					if (firstAuthz != 0) {
						sendErrorResponse(opcode, firstAuthz, AttErrors.INSUFFICIENT_AUTHORIZATION);
					} else if (firstAuth != 0) {
						sendErrorResponse(opcode, firstAuth, AttErrors.INSUFFICIENT_AUTHENTICATION);
					} else if (firstEncKeySize != 0) {
						sendErrorResponse(opcode, firstEncKeySize, AttErrors.INSUFFICIENT_ENCRYPTION_KEY_SIZE);
					} else if (firstEnc != 0) {
						sendErrorResponse(opcode, firstEnc, AttErrors.INSUFFICIENT_ENCRYPTION);
					} else if (firstReadNotPerm != 0) {
						sendErrorResponse(opcode, firstReadNotPerm, AttErrors.READ_NOT_PERMITTED);
					} else if (firstOther != 0) {
						sendErrorResponse(opcode, firstOther, otherErrorType);
					} else {
						sendResponse(Buffer.concat(buffers).slice(0, requestMtu));
					}
				};
				isHandlingRequest = true;
				nextFn(0);
				return;
			case ATT_READ_BY_GROUP_TYPE_REQUEST:
				if (data.length != 7 && data.length != 21) {
					sendErrorResponse(opcode, 0, AttErrors.INVALID_PDU);
					return;
				}
				var startingHandle = data.readUInt16LE(1);
				var endingHandle = data.readUInt16LE(3);
				var attributeGroupType = getFullUuid(data.length == 7 ? data.readUInt16LE(5) : data.slice(5));
				if (startingHandle == 0 || startingHandle > endingHandle) {
					sendErrorResponse(opcode, startingHandle, AttErrors.INVALID_HANDLE);
					return;
				}
				endingHandle = Math.min(endingHandle, attDb.length - 1);
				if (attributeGroupType != '00002800' + BASE_UUID_SECOND_PART && attributeGroupType != '00002801' + BASE_UUID_SECOND_PART) {
					sendErrorResponse(opcode, startingHandle, AttErrors.UNSUPPORTED_GROUP_TYPE);
					return;
				}
				var list = [];
				for (var i = startingHandle; i <= endingHandle; i++) {
					var item = attDb[i];
					if (item && item.uuid == attributeGroupType) {
						var value = item.value.slice(0, Math.min(251, currentMtu - 6));
						if (list.length != 0 && (list[0].value.length != value.length || 2 + (4 + value.length) * (list.length + 1) > currentMtu)) {
							break;
						}
						
						list.push({start: i, end: item.groupEndHandle || i, value: value});
					}
				}
				if (list.length == 0) {
					sendErrorResponse(opcode, startingHandle, AttErrors.ATTRIBUTE_NOT_FOUND);
					return;
				}
				var ret = Buffer.alloc(2 + (4 + list[0].value.length) * list.length);
				ret[0] = ATT_READ_BY_GROUP_TYPE_RESPONSE;
				ret[1] = 4 + list[0].value.length;
				var pos = 2;
				list.forEach(v => {
					ret.writeUInt16LE(v.start, pos);
					ret.writeUInt16LE(v.end, pos + 2);
					v.value.copy(ret, pos + 4);
					pos += 4 + v.value.length;
				});
				sendResponse(ret);
				return;
			case ATT_WRITE_REQUEST:
			case ATT_WRITE_COMMAND:
				var isCommand = opcode == ATT_WRITE_COMMAND;
				if (data.length < 3) {
					isCommand || sendErrorResponse(opcode, 0, AttErrors.INVALID_PDU);
					return;
				}
				var handle = data.readUInt16LE(1);
				var value = data.slice(3);
				var item = attDb[handle];
				if (!item) {
					isCommand || sendErrorResponse(opcode, handle, AttErrors.INVALID_HANDLE);
					return;
				}
				var perm = checkWritePermission(item);
				if (perm != 0) {
					isCommand || sendErrorResponse(opcode, handle, perm);
					return;
				}
				if (!isCommand) {
					isHandlingRequest = true;
				}
				item.authorizeWrite(connection, opcode, 0, Buffer.from(value), function(err) {
					if (connection.disconnected) {
						return;
					}
					if (err) {
						if (!isCommand) {
							sendErrorResponse(opcode, handle, err);
						}
					} else {
						if (value.length > item.maxLength) {
							sendErrorResponse(opcode, handle, AttErrors.INVALID_ATTRIBUTE_VALUE_LENGTH);
							return;
						}
						item.write(connection, opcode, 0, value, function(err) {
							if (!isCommand) {
								if (err) {
									sendErrorResponse(opcode, handle, err);
								} else {
									sendResponse(Buffer.from([ATT_WRITE_RESPONSE]));
								}
							}
						});
					}
				});
				return;
			case ATT_PREPARE_WRITE_REQUEST:
				if (data.length < 5) {
					sendErrorResponse(opcode, 0, AttErrors.INVALID_PDU);
					return;
				}
				var handle = data.readUInt16LE(1);
				var offset = data.readUInt16LE(3);
				var value = data.slice(5);
				var item = attDb[handle];
				if (!item) {
					sendErrorResponse(opcode, handle, AttErrors.INVALID_HANDLE);
					return;
				}
				var perm = checkWritePermission(item);
				if (perm != 0) {
					sendErrorResponse(opcode, handle, perm);
					return;
				}
				isHandlingRequest = true;
				if (prepareWriteQueueSize >= 128) {
					sendErrorResponse(opcode, handle, AttErrors.PREPARE_QUEUE_FULL);
					return;
				}
				item.authorizeWrite(connection, opcode, offset, Buffer.from(value), function(err) {
					if (err) {
						sendErrorResponse(opcode, handle, err);
					} else {
						++prepareWriteQueueSize;
						if (prepareWriteQueue.length > 0) {
							var elem = prepareWriteQueue[prepareWriteQueue.length - 1];
							if (elem.handle == handle && elem.offset + elem.data.length == offset) {
								elem.data = Buffer.concat([elem.data, value]);
								data[0] = ATT_PREPARE_WRITE_RESPONSE;
								sendResponse(data);
								return;
							}
						}
						prepareWriteQueue.push({item: item, handle: handle, offset: offset, data: value});
						data[0] = ATT_PREPARE_WRITE_RESPONSE;
						sendResponse(data);
					}
				});
				return;
			case ATT_EXECUTE_WRITE_REQUEST:
				if (data.length != 2 || data[1] > 0x01) {
					sendErrorResponse(opcode, 0, AttErrors.INVALID_PDU);
					return;
				}
				var flags = data[1];
				if (flags == 0x00 || prepareWriteQueue.length == 0) {
					// Cancel or empty queue
					prepareWriteQueue = [];
					prepareWriteQueueSize = 0;
					sendResponse(Buffer.from([ATT_EXECUTE_WRITE_RESPONSE]));
				} else {
					// Execute
					for (var i = 0; i < prepareWriteQueue.length; i++) {
						var elem = prepareWriteQueue[i];
						if (elem.offset > elem.item.maxLength) {
							prepareWriteQueue = [];
							prepareWriteQueueSize = 0;
							sendErrorResponse(opcode, elem.handle, AttErrors.INVALID_OFFSET);
							return;
						}
						if (elem.offset + elem.data.length > elem.item.maxLength) {
							prepareWriteQueue = [];
							prepareWriteQueueSize = 0;
							sendErrorResponse(opcode, elem.handle, AttErrors.INVALID_ATTRIBUTE_VALUE_LENGTH);
							return;
						}
					}
					isHandlingRequest = true;
					
					var left = prepareWriteQueue.length;
					for (var i = 0; i < prepareWriteQueue.length; i++) {
						var elem = prepareWriteQueue[i];
						(function() {
							var used = false;
							elem.item.write(connection, opcode, elem.offset, elem.data, function(err) {
								if (used) {
									return;
								}
								used = true;
								if (left > 0) {
									if (err) {
										prepareWriteQueue = [];
										prepareWriteQueueSize = 0;
										sendErrorResponse(opcode, elem.handle, err);
										left = 0;
									} else if (--left == 0) {
										prepareWriteQueue = [];
										prepareWriteQueueSize = 0;
										sendResponse(Buffer.from([ATT_EXECUTE_WRITE_RESPONSE]));
									}
								}
							});
						})();
					}
					
					/*var nextFn = function(i) {
						if (i >= prepareWriteQueue.length) {
							prepareWriteQueue = [];
							prepareWriteQueueSize = 0;
							sendResponse(Buffer.from([ATT_EXECUTE_WRITE_RESPONSE]));
							return;
						}
						var elem = prepareWriteQueue[i];
						elem.item.write(connection, opcode, elem.offset, elem.data, function(err) {
							if (err) {
								prepareWriteQueue = [];
								prepareWriteQueueSize = 0;
								sendErrorResponse(opcode, elem.handle, err);
							} else {
								nextFn(i + 1);
							}
						});
					};
					nextFn(0);*/
				}
				return;
			case ATT_HANDLE_VALUE_NOTIFICATION:
			case ATT_HANDLE_VALUE_INDICATION:
				if (data.length < 3) {
					// Drop
					return;
				}
				var handle = data.readUInt16LE(1);
				var value = data.slice(3);
				var isIndication = opcode == ATT_HANDLE_VALUE_INDICATION;
				if (isIndication && hasOutgoingConfirmation) {
					// Client must wait for the confirmation before it sends a new indication
					return;
				}
				if (notifyIndicateCallback) {
					var sentConfirmation = false;
					notifyIndicateCallback(handle, isIndication, value, function() {
						if (isIndication && !sentConfirmation) {
							sentConfirmation = true;
							sendConfirmation();
						}
					});
				} else {
					if (isIndication) {
						sendConfirmation();
					}
				}
				return;
			case ATT_HANDLE_VALUE_CONFIRMATION:
				if (data.length != 1 || !currentOutgoingIndication || !currentOutgoingIndicationIsSent) {
					// Drop
					return;
				}
				currentOutgoingIndication();
				indicationTimeoutClearFn();
				indicationTimeoutClearFn = null;
				currentOutgoingIndication = null;
				sendNextIndication();
				return;
		}
	});
	
	function enqueueRequest(data, callback) {
		requestQueue.push({data: data, callback: callback});
		sendNextRequest();
	}
	
	this.exchangeMtu = function(callback) {
		var clientRxMTU = 517;
		enqueueRequest(Buffer.from([ATT_EXCHANGE_MTU_REQUEST, clientRxMTU, clientRxMTU >> 8]), function(err, data) {
			if (err) {
				callback(err);
				return true;
			}
			if (data.length != 3) {
				return false;
			}
			var serverRxMTU = Math.max(23, data.readUInt16LE(1));
			var newMTU = Math.min(clientRxMTU, serverRxMTU);
			if (currentMtu == 23 && newMTU != 23) {
				currentMtu = newMTU;
			}
			callback(0);
			return true;
		});
	};
	
	this.findInformation = function(startingHandle, endingHandle, callback) {
		var buffer = Buffer.alloc(5);
		buffer[0] = ATT_FIND_INFORMATION_REQUEST;
		buffer.writeUInt16LE(startingHandle, 1);
		buffer.writeUInt16LE(endingHandle, 3);
		enqueueRequest(buffer, function(err, data) {
			if (err) {
				callback(err);
				return true;
			}
			if (data.length < 6) {
				return false;
			}
			var format = data[1];
			if (format > 0x02) {
				return false;
			}
			if ((data.length - 2) % (format == 0x01 ? 4 : 18) != 0) {
				return false;
			}
			var list = [];
			for (var i = 2; i < data.length; i += (format == 0x01 ? 4 : 18)) {
				var handle = data.readUInt16LE(i);
				var uuid = getFullUuid(format == 0x01 ? data.readUInt16LE(i + 2) : data.slice(i + 2, i + 18));
				list.push({handle: handle, uuid: uuid});
			}
			callback(0, list);
			return true;
		});
	};
	
	this.findByTypeValue = function(startingHandle, endingHandle, attributeType, attributeValue, callback) {
		var buffer = Buffer.alloc(7 + attributeValue.length);
		buffer[0] = ATT_FIND_BY_TYPE_VALUE_REQUEST;
		buffer.writeUInt16LE(startingHandle, 1);
		buffer.writeUInt16LE(endingHandle, 3);
		buffer.writeUInt16LE(attributeType, 5);
		attributeValue.copy(buffer, 7);
		enqueueRequest(buffer, function(err, data) {
			if (err) {
				callback(err);
				return true;
			}
			if (data.length < 5) {
				return false;
			}
			if ((data.length - 1) % 4 != 0) {
				return false;
			}
			var list = [];
			for (var i = 1; i < data.length; i += 4) {
				list.push({
					// Keys named to be compatible with Read By Group Type
					attributeHandle: data.readUInt16LE(i),
					endGroupHandle: data.readUInt16LE(i + 2),
					attributeValue: buffer.slice(7)
				});
			}
			callback(0, list);
			return true;
		});
	};
	
	this.readByType = function(startingHandle, endingHandle, attributeType, callback) {
		var attributeTypeBuffer = serializeUuid(attributeType);
		var buffer = Buffer.alloc(5 + attributeTypeBuffer.length);
		buffer[0] = ATT_READ_BY_TYPE_REQUEST;
		buffer.writeUInt16LE(startingHandle, 1);
		buffer.writeUInt16LE(endingHandle, 3);
		attributeTypeBuffer.copy(buffer, 5);
		enqueueRequest(buffer, function(err, data) {
			if (err) {
				callback(err);
				return true;
			}
			if (data.length < 4) {
				return false;
			}
			var length = data[1];
			if (length < 2 || (data.length - 2) % length != 0) {
				return false;
			}
			var list = [];
			for (var i = 2; i < data.length; i += length) {
				list.push({
					attributeHandle: data.readUInt16LE(i),
					attributeValue: data.slice(i + 2, i + length)
				});
			}
			callback(0, list);
			return true;
		});
	};
	
	this.read = function(attributeHandle, callback) {
		enqueueRequest(Buffer.from([ATT_READ_REQUEST, attributeHandle, attributeHandle >> 8]), function(err, data) {
			if (err) {
				callback(err);
				return true;
			}
			callback(0, data.slice(1));
			return true;
		});
	};
	
	this.readBlob = function(attributeHandle, valueOffset, callback) {
		var buffer = Buffer.alloc(5);
		buffer[0] = ATT_READ_BLOB_REQUEST;
		buffer.writeUInt16LE(attributeHandle, 1);
		buffer.writeUInt16LE(valueOffset, 3);
		enqueueRequest(buffer, function(err, data) {
			if (err) {
				callback(err);
				return true;
			}
			callback(0, data.slice(1));
			return true;
		});
	};
	
	this.readMultiple = function(setOfHandles, callback) {
		var buffer = Buffer.alloc(1 + 2 * setOfHandles);
		buffer[0] = ATT_READ_MULTIPLE_REQUEST;
		for (var i = 0; i < setOfHandles.length; i++) {
			buffer.writeUInt16LE(handle, 1 + 2 * i);
		};
		enqueueRequest(buffer, function(err, data) {
			if (err) {
				callback(err);
				return true;
			}
			callback(0, data.slice(1));
			return true;
		});
	};
	
	this.readByGroupType = function(startingHandle, endingHandle, attributeGroupType, callback) {
		var attributeGroupTypeBuffer = serializeUuid(attributeGroupType);
		var buffer = Buffer.alloc(5 + attributeGroupTypeBuffer.length);
		buffer[0] = ATT_READ_BY_GROUP_TYPE_REQUEST;
		buffer.writeUInt16LE(startingHandle, 1);
		buffer.writeUInt16LE(endingHandle, 3);
		attributeGroupTypeBuffer.copy(buffer, 5);
		enqueueRequest(buffer, function(err, data) {
			if (err) {
				callback(err);
				return true;
			}
			if (data.length < 6) {
				return false;
			}
			var length = data[1];
			if (length < 4 || (data.length - 2) % length != 0) {
				return false;
			}
			var list = [];
			for (var i = 2; i < data.length; i += length) {
				list.push({
					attributeHandle: data.readUInt16LE(i),
					endGroupHandle: data.readUInt16LE(i + 2),
					attributeValue: data.slice(i + 4, i + length)
				});
			}
			callback(0, list);
			return true;
		});
	};
	
	this.write = function(attributeHandle, attributeValue, callback) {
		var buffer = Buffer.alloc(3 + attributeValue.length);
		buffer[0] = ATT_WRITE_REQUEST;
		buffer.writeUInt16LE(attributeHandle, 1);
		attributeValue.copy(buffer, 3);
		enqueueRequest(buffer, function(err, data) {
			if (err) {
				callback(err);
				return true;
			}
			if (data.length != 1) {
				return false;
			}
			callback(0);
			return true;
		});
	};
	
	this.writeCommand = function(attributeHandle, attributeValue, sentCallback, completeCallback) {
		attributeValue = attributeValue.slice(0, currentMtu - 3);
		var buffer = Buffer.alloc(3 + attributeValue.length);
		buffer[0] = ATT_WRITE_COMMAND;
		buffer.writeUInt16LE(attributeHandle, 1);
		attributeValue.copy(buffer, 3);
		sendDataFn(buffer, sentCallback, completeCallback);
	};
	
	this.prepareWrite = function(attributeHandle, valueOffset, partAttributeValue, callback) {
		var buffer = Buffer.alloc(5 + partAttributeValue.length);
		buffer[0] = ATT_PREPARE_WRITE_REQUEST;
		buffer.writeUInt16LE(attributeHandle, 1);
		buffer.writeUInt16LE(valueOffset, 3);
		partAttributeValue.copy(buffer, 5);
		enqueueRequest(buffer, function(err, data) {
			if (err) {
				callback(err);
				return true;
			}
			if (data.length < 5) {
				return false;
			}
			callback(0, buffer.slice(1).equals(data.slice(1)));
			return true;
		});
	};
	
	this.executeWrite = function(isExecute, callback) {
		enqueueRequest(Buffer.from([ATT_EXECUTE_WRITE_REQUEST, isExecute ? 0x01 : 0x00]), function(err, data) {
			if (err) {
				callback(err);
				return true;
			}
			if (data.length != 1) {
				return false;
			}
			callback(0);
			return true;
		});
	};
	
	this.notify = function(attributeHandle, attributeValue, sentCallback, completeCallback) {
		var buffer = Buffer.alloc(3 + attributeValue.length);
		buffer[0] = ATT_HANDLE_VALUE_NOTIFICATION;
		buffer.writeUInt16LE(attributeHandle, 1);
		attributeValue.copy(buffer, 3);
		if (currentOutgoingRequest != null && currentOutgoingRequest.responseOpcode == ATT_EXCHANGE_MTU_RESPONSE) {
			notificationQueue.push({data: buffer, sentCallback: sentCallback, completeCallback: completeCallback});
		} else {
			sendDataFn(buffer.slice(0, currentMtu), sentCallback, completeCallback);
		}
	};
	
	this.indicate = function(attributeHandle, attributeValue, callback) {
		var buffer = Buffer.alloc(3 + attributeValue.length);
		buffer[0] = ATT_HANDLE_VALUE_INDICATION;
		buffer.writeUInt16LE(attributeHandle, 1);
		attributeValue.copy(buffer, 3);
		indicationQueue.push({data: buffer, callback: callback});
		sendNextIndication();
	};
	
	this.getCurrentMtu = function() {
		return currentMtu;
	};
}

function RangeMap() {
	// FIXME: maybe create some better tree-based structure to speed up time complexity
	
	var map = []; // {start, end, value}
	
	this.get = function(index) {
		for (var i = 0; i < map.length; i++) {
			var item = map[i];
			if (item.start <= index && index <= item.end) {
				return item;
			}
		}
		return null;
	};
	
	this.remove = function(index) {
		for (var i = 0; i < map.length; i++) {
			var item = map[i];
			if (item.start <= index && index <= item.end) {
				map.splice(i, 1);
				return;
			}
		}
	};
	
	this.insert = function(start, end, value) {
		var i;
		for (i = 0; i < map.length; i++) {
			var item = map[i];
			if (end < item.start) {
				break;
			}
		}
		map.splice(i, 0, {start: start, end: end, value: value});
	};
	
	this.forEach = function(callback) {
		map.forEach(callback);
	};
	
	this.map = function(callback) {
		return map.map(callback);
	};
	
	this.getMap = function() { return map; };
	
	this.toJSON = function() {
		return map;
	};
}

function GattClientService() {
}
function GattClientCharacteristic() {
	EventEmitter.call(this);
}
util.inherits(GattClientCharacteristic, EventEmitter);
function GattClientDescriptor() {
}

function GattConnection(connection, attDb, registerOnDataFn, sendDataFn, registerOnBondedFn) {
	EventEmitter.call(this);
	var gatt = this;
	
	var att = new AttConnection(attDb, connection, registerOnDataFn, sendDataFn, notifyIndicateCallback, timeoutCallback);
	var hasExchangedMtu = false;
	var requestQueue = new Queue();
	var hasPendingRequest = false;
	var inReliableWrite = false;
	var enqueuedReliableWrite = 0;
	
	var gattCache;
	function clearGattCache() {
		gattCache = {
			hasAllPrimaryServices: false,
			allPrimaryServices: new RangeMap(),
			secondaryServices: new RangeMap(),
			primaryServicesByUUID: Object.create(null)
		};
	}
	clearGattCache();
	
	function storeGattCache() {
		if (!connection.smp.isBonded) {
			var gattServiceMap = gattCache[fixUuid(0x1801)];
			if (!gattServiceMap) {
				return;
			}
			var hasGattService = false;
			var foundCharacteristicInService = false;
			var prev = 0x0000;
			var hasHole = false;
			gattServiceMap.forEach(s => {
				if (s.start != prev + 1) {
					hasHole = true;
				}
				if (s.value) {
					hasGattService = true;
					if (s.value.characteristics.some(c => c.uuid == fixUuid(0x2a05))) {
						foundCharacteristicInService = true;
					}
				}
				prev = s.end;
			});
			if (prev != 0xffff) {
				hasHole = true;
			}
			if (hasHole && !hasGattService) {
				// We don't know yet if there exists a GATT service, so don't assume anything yet about whether the Service Changed characteristic exists
				return;
			}
			if (hasGattService && foundCharacteristicInService) {
				// Service Changed characteristic exists => we are not allowed to store a cache
				return;
			}
		}
		
		var peerAddress = connection.smp.isBonded ?
			storage.constructAddress(connection.peerIdentityAddressType, connection.peerIdentityAddress) :
			storage.constructAddress(connection.peerAddressType, connection.peerAddress);
		if (peerAddress.substr(0, 3) == '01:' && ((parseInt(peerAddress.substr(3, 1), 16) - 4) >>> 0) < 4) {
			// Skip random resolvable addresses, since they are generally re-generated all the time
			return;
		}
		
		function mapService(s) {
			return {
				start: s.start,
				end: s.end,
				service: !s.value ? null : {
					uuid: s.value.uuid,
					includedServices: !s.value.includedServices ? null : s.value.includedServices.map(is => { return {
						start: is.start,
						end: is.end,
						uuid: is.uuid
					}}),
					characteristics: !s.value.characteristics ? null : s.value.characteristics.map(c => { return {
						declarationHandle: c.handle,
						end: c.end,
						uuid: c.uuid,
						valueHandle: c.valueHandle,
						properties: c.properties,
						descriptors: !c.descriptors ? null : c.descriptors.map(d => { return {
							handle: d.handle,
							uuid: d.uuid
						}})
					}})
				}
			};
		}
		
		var obj = {
			hasAllPrimaryServices: gattCache.hasAllPrimaryServices,
			allPrimaryServices: gattCache.allPrimaryServices.map(mapService),
			secondaryServices: gattCache.secondaryServices.map(mapService),
			primaryServicesByUUID: Object.keys(gattCache.primaryServicesByUUID).reduce((o, key) => {
				var v = gattCache.primaryServicesByUUID[key];
				o[key] = v.map(s => {return {start: s.start, end: s.end, exists: !!s.value}});
				return o;
			}, {})
		};
		
		storage.storeGattCache(
			storage.constructAddress(connection.ownAddressType, connection.ownAddress),
			peerAddress,
			connection.smp.isBonded,
			obj
		);
	}
	registerOnBondedFn(storeGattCache);
	
	function readGattCache() {
		var peerAddress = connection.smp.isBonded ?
			storage.constructAddress(connection.peerIdentityAddressType, connection.peerIdentityAddress) :
			storage.constructAddress(connection.peerAddressType, connection.peerAddress);
		
		var obj = storage.getGattCache(
			storage.constructAddress(connection.ownAddressType, connection.ownAddress),
			peerAddress
		);
		if (!obj) {
			return;
		}
		
		gattCache.hasAllPrimaryServices = obj.hasAllPrimaryServices;
		
		var handleMap = Object.create(null);
		var visited = [];
		[obj.allPrimaryServices, obj.secondaryServices].forEach((services, i) => {
			services.forEach(s => {
				if (!s.service) {
					(i == 0 ? gattCache.allPrimaryServices : gattCache.secondaryServices).insert(s.start, s.end, null);
					return;
				}
				
				var serviceObj = createGattClientService(s.start, s.end, s.service.uuid, services === obj.allPrimaryServices);
				handleMap[s.start] = serviceObj;
				visited.push({serviceObj: serviceObj, cachedService: s});
				if (s.service.characteristics) {
					serviceObj.characteristics = [];
					s.service.characteristics.forEach(c => {
						var characteristicObj = createCharacteristic(c.declarationHandle, c.properties, c.valueHandle, c.uuid, c.end);
						serviceObj.characteristics.push(characteristicObj);
						if (c.descriptors) {
							characteristicObj.descriptors = [];
							c.descriptors.forEach(d => {
								var descriptorObj = createDescriptor(d.handle, d.uuid);
								characteristicObj.descriptors.push(descriptorObj);
							});
						}
					});
				}
			});
		});
		
		visited.forEach(v => {
			if (v.cachedService.includedServices) {
				v.serviceObj.includedServices = v.cachedService.includedServices.map(include => handleMap[include.start]);
			}
		});
		
		
		Object.keys(obj.primaryServicesByUUID).forEach(uuid => {
			var map = obj.primaryServicesByUUID[uuid];
			map.forEach(range => {
				if (!range.exists) {
					var map = gattCache.primaryServicesByUUID[uuid];
					if (!map) {
						map = new RangeMap();
						gattCache.primaryServicesByUUID[uuid] = map;
					}
					map.insert(range.start, range.end, null);
				}
			});
		});
		
		//console.log('Gatt cache loaded:');
		//console.log(JSON.stringify(gattCache));
	}
	readGattCache();
	
	function timeoutCallback() {
		if (gatt.listenerCount('timeout') > 0) {
			gatt.emit('timeout');
		} else {
			connection.disconnect();
		}
	}
	
	function readShort(obj, handle, callback) {
		callback = fixCallback(obj, callback);
		enqueueRequest(function() {
			att.read(handle, function(err, value) {
				callback(err, value);
				doneNextRequest();
			});
		});
	}
	function readLong(obj, handle, offset, callback) {
		validate(typeof offset === 'number' && offset >= 0 && offset <= 512 && (offset | 0) == offset, 'Invalid offset');
		callback = fixCallback(obj, callback);
		
		enqueueRequest(function() {
			var buffers = [];
			function nextBlob(offset) {
				var mtu = att.getCurrentMtu();
				var cb = function(err, value) {
					if (err) {
						callback(err);
						doneNextRequest();
						return;
					}
					buffers.push(value);
					if (value.length == mtu - 1 && offset + value.length < 512) {
						nextBlob(offset + value.length);
					} else {
						callback(0, Buffer.concat(buffers));
						doneNextRequest();
					}
				};
				if (offset == 0) {
					att.read(handle, cb);
				} else {
					att.readBlob(handle, offset, cb);
				}
			}
			nextBlob(offset);
		});
	}
	function write(obj, isDescriptor, handle, value, offset, callback) {
		validate(typeof offset === 'number' && offset >= 0 && offset <= 512 && (offset | 0) == offset, 'Invalid offset');
		validate((value instanceof Buffer) || (typeof value === 'string'), 'Invalid value type');
		validate(!((enqueuedReliableWrite != 0 || inReliableWrite) && isDescriptor && (offset != 0 || value.length > att.getCurrentMtu() - 3)), 'Cannot write long descriptor while Reliable Write is activated');
		callback = fixCallback(obj, callback);
		
		value = Buffer.from(value); // Make an own copy
		validate(offset + value.length <= 512, 'Invalid value length');
		
		enqueueRequest(function() {
			if (offset == 0 && value.length <= att.getCurrentMtu() - 3 && (!inReliableWrite || isDescriptor)) {
				att.write(handle, value, function(err) {
					callback(err);
					doneNextRequest();
				});
				return;
			}
			var atLeastOneSuccess = false;
			var startOffset = offset;
			function nextPart(offset) {
				if (offset == startOffset + value.length && atLeastOneSuccess) {
					if (inReliableWrite) {
						callback(0);
						doneNextRequest();
					} else {
						att.executeWrite(true, function(err) {
							callback(err);
							doneNextRequest();
						});
					}
				} else {
					var partValue = value.slice(offset - startOffset, offset - startOffset + att.getCurrentMtu() - 5);
					att.prepareWrite(handle, offset, partValue, function(err, ok) {
						if (err) {
							if (atLeastOneSuccess && !inReliableWrite) {
								att.executeWrite(false, function(err2) {
									callback(err);
									doneNextRequest();
								});
							} else {
								callback(err);
								doneNextRequest();
							}
							return;
						}
						if (!ok && inReliableWrite) {
							att.executeWrite(false, function(err2) {
								inReliableWrite = false;
								callback(-1);
								doneNextRequest();
							});
							return;
						}
						atLeastOneSuccess = true;
						nextPart(offset + partValue.length);
					});
				}
			}
			nextPart(startOffset);
		});
	}
	function writeWithoutResponse(obj, handle, value, sentCallback, completeCallback) {
		sentCallback = fixCallback(obj, sentCallback);
		completeCallback = fixCallback(obj, completeCallback);
		validate(value instanceof Buffer && value.length <= 512, 'Invalid value');
		
		att.writeCommand(handle, value.slice(0, att.getCurrentMtu() - 3), sentCallback, completeCallback);
	}
	
	function setupReadWrite(obj, isDescriptor, handle) {
		obj.read = function(callback) {
			readLong(this, handle, 0, callback);
		};
		obj.readShort = function(callback) {
			readShort(this, handle, callback);
		};
		obj.readLong = function(offset, callback) {
			readLong(this, handle, offset, callback);
		};
		obj.write = function(value, callback) {
			write(this, isDescriptor, handle, value, 0, callback);
		};
		obj.writeLong = function(value, offset, callback) {
			write(this, isDescriptor, handle, value, offset, callback);
		};
		if (!isDescriptor) {
			obj.writeWithoutResponse = function(value, sentCallback, completeCallback) {
				writeWithoutResponse(this, handle, value, sentCallback, completeCallback);
			};
			obj.writeCCCD = function(enableNotifications, enableIndications, callback) {
				callback = fixCallback(obj, callback);
				validate(!enableNotifications || obj.properties['notify'], 'Cannot enable notifications on a characteristic without the notify property.');
				validate(!enableIndications || obj.properties['indicate'], 'Cannot enable indications on a characteristic without the indicate property.');
				obj.discoverDescriptors(function(descriptors) {
					var cccd = descriptors.find(d => d.uuid == fixUuid(0x2902));
					if (cccd) {
						cccd.write(Buffer.from([(enableNotifications ? 1 : 0) | (enableIndications ? 2 : 0), 0]), callback);
					} else {
						callback(AttErrors.ATTRIBUTE_NOT_FOUND);
					}
				});
			};
		}
	}
	
	function createDescriptor(handle, uuid) {
		var d = new GattClientDescriptor();
		Object.defineProperty(d, 'handle', {
			value: handle,
			enumerable: true,
			configurable: false,
			writable: false
		});
		Object.defineProperty(d, 'uuid', {
			value: uuid,
			enumerable: true,
			configurable: false,
			writable: false
		});
		setupReadWrite(d, true, handle);
		return {handle: handle, uuid: uuid, descriptor: d};
	}
	
	function createCharacteristic(handle, properties, valueHandle, uuid, end) {
		var characteristic = {
			handle: handle,
			properties: properties,
			valueHandle: valueHandle,
			uuid: uuid,
			end: end,
			descriptors: null,
			discoverAllCharacteristicDescriptors: function(callback) {
				if (valueHandle == end) {
					characteristic.descriptors = [];
					callback();
					return;
				}
				
				var found = [];
				function next(i) {
					att.findInformation(i, end, function(err, list) {
						list = list || [];
						var last = i - 1;
						var max = 0;
						list.forEach(v => {
							max = Math.max(max, v.handle);
							if (v.handle <= last || v.handle > end) {
								// Invalid, drop
								return;
							}
							found.push(v);
							last = v.handle;
						});
						if (list.length == 0 || last >= end) {
							characteristic.descriptors = found.map(v => createDescriptor(v.handle, v.uuid));
							storeGattCache();
							callback();
						} else {
							next(last + 1);
						}
					});
				}
				next(valueHandle + 1);
			}
		};
		
		var c = new GattClientCharacteristic();
		characteristic.characteristic = c;
		Object.defineProperty(c, 'properties', {
			value: Object.freeze({
				broadcast: (properties & 0x01) != 0,
				read: (properties & 0x02) != 0,
				writeWithoutResponse: (properties & 0x04) != 0,
				write: (properties & 0x08) != 0,
				notify: (properties & 0x10) != 0,
				indicate: (properties & 0x20) != 0,
				authenticatedSignedWrites: (properties & 0x40) != 0,
				extendedProperties: (properties & 0x80) != 0
			}),
			enumerable: true,
			configurable: false,
			writable: false
		});
		Object.defineProperty(c, 'declarationHandle', {
			value: handle,
			enumerable: true,
			configurable: false,
			writable: false
		});
		Object.defineProperty(c, 'valueHandle', {
			value: valueHandle,
			enumerable: true,
			configurable: false,
			writable: false
		});
		Object.defineProperty(c, 'uuid', {
			value: uuid,
			enumerable: true,
			configurable: false,
			writable: false
		});
		setupReadWrite(c, false, valueHandle);
		c.discoverDescriptors = function(callback) {
			callback = fixCallback(c, callback);
			
			if (characteristic.descriptors != null) {
				callback(characteristic.descriptors.map(v => v.descriptor));
				return;
			}
			enqueueRequest(function() {
				if (characteristic.descriptors != null) {
					callback(characteristic.descriptors.map(v => v.descriptor));
					doneNextRequest();
					return;
				}
				characteristic.discoverAllCharacteristicDescriptors(function() {
					callback(characteristic.descriptors.map(v => v.descriptor));
					doneNextRequest();
				});
			});
		};
		return characteristic;
	}
	
	function createGattClientService(start, end, uuid, isPrimary) {
		//console.log('creating ' + start + ', ' + end + ', ' + uuid + ', ' + isPrimary);
		
		var service = {
			start: start,
			end: end,
			uuid: uuid,
			characteristics: null,
			includedServices: null,
			findIncludedServices: function(callback) {
				var found = [];
				function next(i) {
					att.readByType(i, end, 0x2802, function(err, list) {
						list = list || [];
						var last = i - 1;
						var max = 0;
						list.forEach(v => {
							max = Math.max(max, v.attributeHandle);
							if (v.attributeHandle <= last || v.attributeHandle > end || (v.attributeValue.length != 4 && v.attributeValue != 6)) {
								// Invalid, drop
								return;
							}
							found.push({
								includedServiceAttributeHandle: v.attributeValue.readUInt16LE(0),
								endGroupHandle: v.attributeValue.readUInt16LE(2),
								serviceUUID: v.attributeValue.length == 6 ? getFullUuid(v.attributeValue.readUInt16LE(4)) : null
							});
							last = v.attributeHandle;
						});
						if (list.length == 0 || max >= end) {
							function next128(j) {
								while (true) {
									if (j == found.length) {
										service.includedServices = [];
										found.filter(v => v.serviceUUID != null).map(v => {
											var s = gattCache.secondaryServices.get(v.includedServiceAttributeHandle);
											if (!s) {
												s = createGattClientService(v.includedServiceAttributeHandle, v.endGroupHandle, false);
											}
											service.includedServices.push(s);
										});
										storeGattCache();
										callback();
										return;
									}
									if (found[j].serviceUUID != null) {
										j++;
									} else {
										break;
									}
								}
								att.read(found[j].includedServiceAttributeHandle, function(err, value) {
									if (!err && value.length == 16) {
										found[j].serviceUUID = getFullUuid(value);
									}
									next128(j + 1);
								});
							}
							next128(0);
						} else {
							next(last + 1);
						}
					});
				}
				next(start);
			},
			discoverAllCharacteristics: function(callback) {
				var found = [];
				function next(i) {
					att.readByType(i, end, 0x2803, function(err, list) {
						list = list || [];
						var last = i - 1;
						var max = 0;
						list.forEach(v => {
							max = Math.max(max, v.attributeHandle);
							if (v.attributeHandle <= last || v.attributeHandle > end || (v.attributeValue.length != 5 && v.attributeValue.length != 19)) {
								// Invalid, drop
								return;
							}
							found.push({
								declarationHandle: v.attributeHandle,
								properties: v.attributeValue[0],
								valueHandle: v.attributeValue.readUInt16LE(1),
								uuid: getFullUuid(v.attributeValue.slice(3))
							});
							last = v.attributeHandle;
						});
						if (list.length == 0 || max >= end) {
							service.characteristics = [];
							for (var j = 0; j < found.length; j++) {
								var endingHandle = j + 1 < found.length ? found[j + 1].declarationHandle - 1 : end;
								var v = found[j];
								service.characteristics.push(createCharacteristic(v.declarationHandle, v.properties, v.valueHandle, v.uuid, endingHandle));
							}
							storeGattCache();
							callback();
						} else {
							next(last + 1);
						}
					});
				}
				next(start);
			}
		};
		var s = new GattClientService();
		service.service = s;
		Object.defineProperty(s, 'startHandle', {
			value: start,
			enumerable: true,
			configurable: false,
			writable: false
		});
		Object.defineProperty(s, 'endHandle', {
			value: end,
			enumerable: true,
			configurable: false,
			writable: false
		});
		Object.defineProperty(s, 'uuid', {
			value: uuid,
			enumerable: true,
			configurable: false,
			writable: false
		});
		s.findIncludedServices = function(callback) {
			callback = fixCallback(s, callback);
			
			if (service.includedServices) {
				callback(service.includedServices.map(s => s.service));
				return;
			}
			enqueueRequest(function() {
				if (service.includedServices) {
					callback(service.includedServices.map(s => s.service));
					doneNextRequest();
					return;
				}
				service.findIncludedServices(function() {
					callback(service.includedServices.map(s => s.service));
					doneNextRequest();
				});
			});
		};
		s.discoverCharacteristics = function(callback) {
			callback = fixCallback(s, callback);
			
			if (service.characteristics) {
				callback(service.characteristics.map(v => v.characteristic));
				return;
			}
			enqueueRequest(function() {
				if (service.characteristics) {
					callback(service.characteristics.map(v => v.characteristic));
					doneNextRequest();
					return;
				}
				service.discoverAllCharacteristics(function() {
					callback(service.characteristics.map(v => v.characteristic));
					doneNextRequest();
				});
			});
		};
		if (isPrimary) {
			gattCache.allPrimaryServices.insert(start, end, service);
			var map = gattCache.primaryServicesByUUID[uuid];
			if (!map) {
				map = new RangeMap();
				gattCache.primaryServicesByUUID[uuid] = map;
			}
			map.insert(start, end, service);
		} else {
			gattCache.secondaryServices.insert(start, end, service);
		}
		return service;
	}
	
	function discoverPrimaryServices(uuid, numToFind, callback) {
		callback = fixCallback(this, callback);
		
		function execute(inRequest) {
			if (gattCache.hasAllPrimaryServices) {
				var result = [];
				gattCache.allPrimaryServices.forEach(v => {
					if (v.value != null && (!uuid || v.value.uuid == uuid)) {
						result.push(v.value.service);
					}
				});
				callback(result);
				if (inRequest) {
					doneNextRequest();
				}
				return;
			}
			var map;
			if (!uuid) {
				map = gattCache.allPrimaryServices;
			} else {
				map = gattCache.primaryServicesByUUID[uuid];
				if (!map) {
					map = new RangeMap();
					gattCache.primaryServicesByUUID[uuid] = map;
				}
			}
			var rangesToCheck = [];
			
			var numFound = 0;
			var last = 0;
			map.forEach(item => {
				if (item.value != null) {
					++numFound;
				}
				if (item.start > last + 1) {
					rangesToCheck.push({start: last + 1, end: item.start - 1});
				}
				last = item.end;
			});
			if (last != 0xffff) {
				rangesToCheck.push({start: last + 1, end: 0xffff});
			}
			if (!inRequest && rangesToCheck.length != 0) {
				enqueueRequest(function() {
					execute(true);
				});
				return;
			}
			function next(i, maxCheckedHandle) {
				if (i == rangesToCheck.length || numFound >= numToFind) {
					if (maxCheckedHandle != 0) {
						// We have now checked the whole range (up to maxCheckedHandle), so mark potential holes as not unknown anymore
						function fillHoles(map) {
							//console.log('before', map.getMap());
							var last = 0;
							var holes = [];
							map.forEach(item => {
								if (item.start > maxCheckedHandle) {
									return;
								}
								if (item.start > last + 1) {
									holes.push({start: last + 1, end: item.start - 1});
								}
								last = item.end;
							});
							if (last < maxCheckedHandle) {
								holes.push({start: last + 1, end: maxCheckedHandle});
							}
							holes.forEach(v => {
								map.insert(v.start, v.end, null);
							});
							//console.log('after', map.getMap());
						}
						fillHoles(map);
						if (!uuid) {
							for (var uuidKey in gattCache.primaryServicesByUUID) {
								fillHoles(gattCache.primaryServicesByUUID[uuidKey]);
							}
							if (numToFind >= 0xffff) {
								gattCache.hasAllPrimaryServices = true;
							}
						}
					}
					storeGattCache();
					var result = [];
					map.forEach(v => {
						if (v.value != null) {
							result.push(v.value.service);
						}
					});
					callback(result);
					if (inRequest) {
						doneNextRequest();
					}
					return;
				}
				function nextSubRange(startingHandle) {
					var cb = function(err, list) {
						list = list || [];
						var end = startingHandle - 1;
						var last = startingHandle - 1;
						list.forEach(v => {
							end = Math.max(end, v.endGroupHandle);
							var uuid = getFullUuid(v.attributeValue);
							if (!uuid || v.attributeHandle <= last || v.attributeHandle > v.endGroupHandle || v.endGroupHandle > rangesToCheck[i].end) {
								// Invalid, drop item (the last case is really not invalid, but ignore anyway since it doesn't match our previous cache)
								return;
							}
							if (!gattCache.allPrimaryServices.get(v.attributeHandle)) {
								var s = gattCache.secondaryServices.get(v.attributeHandle);
								if (s) {
									gattCache.allPrimaryServices.insert(s.start, s.end, s);
									gattCache.secondaryServices.remove(s.start);
								} else {
									createGattClientService(v.attributeHandle, v.endGroupHandle, uuid, true);
								}
							}
							++numFound;
							last = v.endGroupHandle;
						});
						if (list.length == 0 || end >= rangesToCheck[i].end || numFound >= numToFind) {
							next(i + 1, list.length == 0 ? rangesToCheck[i].end : end);
						} else {
							nextSubRange(end + 1);
						}
					};
					if (uuid) {
						att.findByTypeValue(startingHandle, rangesToCheck[i].end, 0x2800, serializeUuid(uuid), cb);
					} else {
						att.readByGroupType(startingHandle, rangesToCheck[i].end, 0x2800, cb);
					}
				}
				nextSubRange(rangesToCheck[i].start);
			}
			next(0, 0);
		}
		
		execute(false);
	}
	
	function nextRequest() {
		if (!hasPendingRequest) {
			var fn = requestQueue.shift();
			if (fn) {
				hasPendingRequest = true;
				fn();
			}
		}
	}
	
	function doneNextRequest() {
		hasPendingRequest = false;
		nextRequest();
	}
	
	function enqueueRequest(fn) {
		requestQueue.push(fn);
		nextRequest();
	}
	
	function notifyIndicateCallback(handle, isIndication, value, callback) {
		var service = gattCache.allPrimaryServices.get(handle) || gattCache.secondaryServices.get(handle);
		if (service && service.value.characteristics != null) {
			var cs = service.value.characteristics;
			for (var i = 0; i < cs.length; i++) {
				if (cs[i].valueHandle == handle) {
					var c = cs[i].characteristic;
					var lc = c.listenerCount('change');
					if (lc == 0) {
						break;
					}
					c.emit('change', value, isIndication, callback);
					return;
				}
			}
		}
		callback();
		return;
	}
	
	this.exchangeMtu = function(callback) {
		callback = fixCallback(this, callback);
		validate(!hasExchangedMtu, 'Has already exchanged MTU');
		
		hasExchangedMtu = true;
		
		enqueueRequest(function() {
			att.exchangeMtu(function(err) {
				callback(err);
				doneNextRequest();
			});
		});
	};
	
	this.beginReliableWrite = function() {
		++enqueuedReliableWrite;
		enqueueRequest(function() {
			--enqueuedReliableWrite;
			inReliableWrite = true;
			doneNextRequest();
		});
	};
	
	this.cancelReliableWrite = function(callback) {
		callback = fixCallback(this, callback);
		
		enqueueRequest(function() {
			att.executeWrite(false, function(err) {
				inReliableWrite = false;
				callback(err);
				doneNextRequest();
			});
		});
	};
	
	this.commitReliableWrite = function(callback) {
		callback = fixCallback(this, callback);
		
		enqueueRequest(function() {
			att.executeWrite(true, function(err) {
				inReliableWrite = false;
				callback(err);
				doneNextRequest();
			});
		});
	};
	
	this.discoverAllPrimaryServices = function(callback) {
		callback = fixCallback(this, callback);
		discoverPrimaryServices(null, 0xffff, callback);
	};
	
	this.discoverServicesByUuid = function(uuid, numToFind, callback) {
		uuid = fixUuid(uuid);
		validate(typeof numToFind === 'undefined' || (Number.isInteger(numToFind) && numToFind >= 0), 'Invalid numToFind. Must be either undefined or a non-negative integer.');
		if (typeof numToFind === 'undefined') {
			numToFind = 0xffff;
		}
		callback = fixCallback(this, callback);
		
		discoverPrimaryServices(uuid, numToFind, callback);
	};
	
	this.readUsingCharacteristicUuid = function(startHandle, endHandle, uuid, callback) {
		validate(Number.isInteger(startHandle) && startHandle >= 0x0001 && startHandle <= 0xffff, 'Invalid startHandle. Must be an integer between 0x0001 and 0xffff.');
		validate(Number.isInteger(endHandle) && endHandle >= 0x0001 && endHandle <= 0xffff, 'Invalid endHandle. Must be an integer between 0x0001 and 0xffff.');
		validate(startHandle <= endHandle, 'The startHandle must not be larger than the endHandle.');
		uuid = fixUuid(uuid);
		callback = fixCallback(this, callback);
		
		enqueueRequest(startHandle, endHandle, uuid, function() {
			att.readByType(function(err, list) {
				callback(err, list);
				doneNextRequest();
			});
		});
	};
	
	this.invalidateServices = function(startHandle, endHandle, callback) {
		validate(Number.isInteger(startHandle) && startHandle >= 0x0001 && startHandle <= 0xffff, 'Invalid startHandle. Must be an integer between 0x0001 and 0xffff.');
		validate(Number.isInteger(endHandle) && endHandle >= 0x0001 && endHandle <= 0xffff, 'Invalid endHandle. Must be an integer between 0x0001 and 0xffff.');
		validate(startHandle <= endHandle, 'The startHandle must not be larger than the endHandle.');
		callback = fixCallback(this, callback);
		
		enqueueRequest(function() {
			var modified = false;
			if (startHandle == 0x0001 && endHandle == 0xffff) {
				clearGattCache();
				modified = true;
			} else {
				var maps = [gattCache.allPrimaryServices, gattCache.secondaryServices];
				for (var uuidKey in gattCache.primaryServicesByUUID) {
					maps.push(gattCache.primaryServicesByUUID);
				}
				maps.forEach(map => {
					var toRemove = [];
					map.forEach(v => {
						if (v.start <= endHandle && v.end >= startHandle) {
							toRemove.push(v.start);
						}
					});
					toRemove.forEach(handle => {
						map.remove(handle);
						modified = true;
					});
				});
				
				// If the handles of an included service has been modified, invalidate the entry in the original service and create a new,
				// forcing rediscovery of its included services, characteristics and descriptors.
				// Assume that the start, end, uuid of the included has not been modified, since otherwise the enclosing service should have
				// been included in the invalidated range also.
				[gattCache.allPrimaryServices, gattCache.secondaryServices].forEach(map => {
					map.forEach(v => {
						if (v.includedServices != null) {
							for (var i = 0; i < v.includedServices.length; i++) {
								var s = v.includedServices[i];
								if (s.start <= endHandle && s.end >= startHandle) {
									v.includedServices[i] = createGattClientService(s.start, s.end, s.uuid, false);
									// assert (modified === true)
								}
							}
						}
					});
				});
			}
			if (modified) {
				hasAllPrimaryServices = false;
				storeGattCache();
			}
			callback();
			doneNextRequest();
		});
	};
	
	Object.defineProperty(this, 'currentMtu', {enumerable: true, configurable: false, get: () => att.getCurrentMtu()});
	
	Object.defineProperty(this, '_notify', {enumerable: false, configurable: false, writable: false, value: function(attributeHandle, attributeValue, sentCallback, completeCallback) {
		att.notify(attributeHandle, attributeValue, sentCallback, completeCallback);
	}});
	Object.defineProperty(this, '_indicate', {enumerable: false, configurable: false, writable: false, value: function(attributeHandle, attributeValue, callback) {
		att.indicate(attributeHandle, attributeValue, callback);
	}});
}
util.inherits(GattConnection, EventEmitter);

module.exports = Object.freeze({
	GattConnection: GattConnection,
	GattServerDb: GattServerDb
});
