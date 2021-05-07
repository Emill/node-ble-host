const EventEmitter = require('events');
const util = require('util');

const utils = require('./internal/utils');
const DuplicateCache = utils.DuplicateCache;
const IdGenerator = utils.IdGenerator;
const Queue = utils.Queue;
const Adapter = require('./internal/adapter');
const storage = require('./internal/storage');
const Errors = require('./errors');
const L2CAPCoCErrors = require('./l2cap-coc-errors');
const GattConnection = require('./internal/gatt').GattConnection;
const GattServerDb = require('./internal/gatt').GattServerDb;
const Smp = require('./internal/smp');

const BASE_UUID_SECOND_PART = '-0000-1000-8000-00805F9B34FB';

const WHITE_LIST_USAGE_SCANNER = 1;
const WHITE_LIST_USAGE_INITIATOR = 2;

const STATE_NONCONN_ADV = 0;
const STATE_SCANNABLE_ADV = 1;
const STATE_CONNECTABLE_ADV = 2;
const STATE_HIGH_DUTY_DIR_ADV = 3;
const STATE_PASSIVE_SCANNING = 4;
const STATE_ACTIVE_SCANNING = 5;
const STATE_INITIATING = 6;
const STATE_SLAVE = 7;
const STATE_MASTER = 8;
const STATE_LOW_DUTY_DIR_ADV = 9;
const STATE_NONE = 10;

const L2CAP_SIG_COMMAND_REJECT = 0x01;
const L2CAP_SIG_DISCONNECTION_REQUEST = 0x06;
const L2CAP_SIG_CONNECTION_PARAMETER_UPDATE_REQUEST = 0x12;
const L2CAP_SIG_LE_CREDIT_BASED_CONNECTION_REQUEST = 0x14;
const L2CAP_SIG_LE_FLOW_CONTROL_CREDIT = 0x16;

const idGenerator = new IdGenerator();

function isValidBdAddr(bdAddr) {
	return typeof bdAddr === 'string' && /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(bdAddr);
}
function isValidUuid(uuid) {
	return typeof uuid === 'string' && /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/.test(uuid);
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

function isEmpty(dict) {
	for (var key in dict) {
		if (dict.hasOwnProperty(key)) {
			return false;
		}
	}
	return true;
}

function arraysAreEqual(arr1, arr2) {
	return arr1.length == arr2.length && arr1.every((a, i) => a == arr2[i]);
}

function makeConnParamsValid(p) {
	// Assumes valid values and value pairs, unless null
	p = Object.assign(Object.create(null), p); // Copy object
	
	if (p.connIntervalMin == null || p.connIntervalMax == null) {
		p.connIntervalMin = 20;
		p.connIntervalMax = 25;
	}
	if (p.connIntervalMin > p.connIntervalMax) {
		p.connIntervalMin = p.connIntervalMax;
	}
	if (p.connLatency == null) {
		p.connLatency = 0;
	}
	if (p.supervisionTimeout == null) {
		p.supervisionTimeout = 500;
	}
	var lowestTimeout = Math.max(10, ((p.connIntervalMax * (p.connLatency + 1) * 2) / 8 + 1) | 0);
	if (p.supervisionTimeout < lowestTimeout) {
		p.supervisionTimeout = lowestTimeout;
	}
	if (p.supervisionTimeout > 3200) {
		p.connLatency = Math.ceil(p.supervisionTimeout * 8 / 2 / p.connIntervalMax) - 1;
	}
	if (p.minimumCELength == null || p.maximumCELength == null) {
		p.minimumCELength = 0;
		p.maximumCELength = 0;
	}
	return p;
}

function validateConnectionParameters(p) {
	if (!p) {
		p = Object.create(null);
	}
	p = JSON.parse(JSON.stringify(p));
	if (!Number.isFinite(p.connIntervalMin)) {
		p.connIntervalMin = null;
	}
	if (!Number.isFinite(p.connIntervalMax)) {
		p.connIntervalMax = null;
	}
	if (!Number.isFinite(p.connLatency)) {
		p.connLatency = null;
	}
	if (!Number.isFinite(p.supervisionTimeout)) {
		p.supervisionTimeout = null;
	}
	if (!Number.isFinite(p.minimumCELength)) {
		p.minimumCELength = null;
	}
	if (!Number.isFinite(p.maximumCELength)) {
		p.maximumCELength = null;
	}
	
	function validateIntegerRange(value, min, max, failMsg) {
		validate(value === null || (Number.isInteger(value) && value >= min && value <= max), failMsg);
	}
	
	validateIntegerRange(p.connIntervalMin, 6, 3200, 'Connection interval min must be an integer between 6 and 3200 in units of 1.25ms');
	validateIntegerRange(p.connIntervalMax, 6, 3200, 'Connection interval max must be an integer between 6 and 3200 in units of 1.25ms');
	validate(!p.connIntervalMin == !p.connIntervalMax, 'Either none or both of connection interval min/max must be supplied');
	if (p.connIntervalMin) {
		validate(p.connIntervalMin <= p.connIntervalMax, 'Connection interval min must be <= max');
	}
	
	validateIntegerRange(p.minimumCELength, 0, 0xffff, 'Connection event length min must be an integer between 0 and 65535 in units of 0.625ms');
	validateIntegerRange(p.maximumCELength, 0, 0xffff, 'Connection event length max must be an integer between 0 and 65535 in units of 0.625ms');
	validate((p.minimumCELength === null) == (p.maximumCELength === null), 'Either none or both of connection event length min/max must be supplied');
	if (p.minimumCELength) {
		validate(p.minimumCELength <= p.maximumCELength, 'Connection event length min must be <= max');
	}
	
	validateIntegerRange(p.connLatency, 0, 499, 'Slave latency must be an integer between 0 and 499');
	validateIntegerRange(p.supervisionTimeout, 10, 3200, 'Supervision timeout must be an integer between 10 and 3200 in units of 10ms');
	
	if (p.connIntervalMin !== null && p.supervisionTimeout !== null) {
		var lowestTimeout = Math.max(10, ((p.connIntervalMax * (p.connLatency + 1) * 2) / 8 + 1) | 0); // Works also for connLatency == null
		validate(lowestTimeout <= p.supervisionTimeout, 'Supervision timeout must be at least ' + lowestTimeout + ' to match the other parameters');
	}
	
	return p;
}


function Scanner() {
	EventEmitter.call(this);
	this.stopScan = function() {};
}
util.inherits(Scanner, EventEmitter);

function PendingConnection() {
	EventEmitter.call(this);
	this.cancel = function() {};
}
util.inherits(PendingConnection, EventEmitter);

function Connection() {
	EventEmitter.call(this);
	this.disconnect = function() {};
}
util.inherits(Connection, EventEmitter);

function BdAddrScanFilter(addressType, address) {
	validate(addressType === "public" || addressType === "random", "Invalid address type (must be the string public or random)");
	validate(isValidBdAddr(address), "Invalid address");
	
	Object.defineProperty(this, 'combinedAddress', {writable: false, enumerable: true, configurable: false, value: (addressType == "public" ? "00:" : "01:") + address.toUpperCase()});
}

function ServiceUUIDScanFilter(uuid) {
	validate(isValidUuid(uuid), "Invalid uuid (must be on the form 00000000-0000-0000-0000-000000000000");
	
	uuid = uuid.toUpperCase();
	
	Object.defineProperty(this, 'uuid', {writable: false, enumerable: true, configurable: false, value: uuid});
}

function BleManager(transport, staticRandomAddress, initCallback) {
	EventEmitter.call(this);
	
	var manager = this;
	var adapter = Adapter(transport, onHardwareError);
	var initComplete = false;
	var closed = false;
	var initTriesLeft = 2;
	
	var controllerBdAddr = staticRandomAddress || null;
	var whiteListSize = null;
	var leSupportedStates = null;
	var ownAddressType = staticRandomAddress ? 'random' : 'public';
	var isAdvertisingUserSet = false;
	var isAdvertisingAccordingToStatus = false;
	var startAdvQueueSize = 0;
	
	var scanners = {};
	var scanEnabled = false;
	var scannerCommandInProgress = false;
	var scanningNeedsRestart = false;
	var currentScanParameters = {
		leScanType: 0x00, // passive
		leScanInterval: 0x0010, // 10ms
		leScanWindow: 0x0010, // 10ms
		scanningFilterPolicy: 0x00 // All
	};
	var currentScanFilterDuplicates = false;
	var connectingExplicitly = false;
	var stopScanCallback = null;
	
	var pendingConnections = {};
	var connections = {};
	var pendingConnectScanner = null;
	var connectCommandInProgress = false;
	var cancelCommandInProgress = false;
	var createConnectionIsOutstanding = false;
	var currentConnectingAddresses = null;
	
	var whiteListUsage = null; // WHITE_LIST_USAGE_SCANNER or WHITE_LIST_USAGE_INITIATOR
	var currentWhiteList = []; // Array of (00: or 01: concatenated with the address)
	
	var gattDbOnConnected1, gattDbOnConnected2, gattDbOnDisconnected, gattDbOnBonded;
	var attDb;
	
	var gattDb = new GattServerDb(function(callback) {
		gattDbOnConnected1 = callback;
	}, function(callback) {
		gattDbOnConnected2 = callback;
	}, function(callback) {
		gattDbOnDisconnected = callback;
	}, function(callback) {
		gattDbOnBonded = callback;
	}, function(db) {
		attDb = db;
	});
	
	var timeouts = Object.create(null);
	Object.defineProperty(manager, 'setTimeout', {enumerable: true, configurable: false, writable: false, value: function(callback, milliseconds) {
		callback = fixCallback(manager, callback);
		if (closed) {
			return function() {};
		}
		var id = idGenerator.next();
		timeouts[id] = setTimeout(function() {
			delete timeouts[id];
			callback();
		}, milliseconds);
		return function() {
			if (id in timeouts) {
				clearTimeout(timeouts[id]);
				delete timeouts[id];
			}
		};
	}});
	function clearTimeouts() {
		for (id in timeouts) {
			clearTimeout(timeouts[id]);
		}
		timeouts = Object.create(null);
	}
	
	function afterClose(error) {
		adapter.stop();
		transport.removeListener('close', onClose);
		clearTimeouts();
		closed = true;
		manager.emit('error', error);
	}
	
	function onHardwareError(hardwareCode) {
		if (!initComplete) {
			init(initCallback);
		} else {
			var error = new Error('Hardware Error event received with code ' + hardwareCode);
			afterClose(error);
		}
	}
	
	function onClose() {
		var error = new Error('Transport closed');
		afterClose(error);
	}
	
	transport.on('close', onClose);
	
	init(initCallback);
	function init(callback) {
		function fail(commandName, status) {
			callback(new Error(commandName + " failed with status: " + Errors.toString(status)));
		}
		
		if (initTriesLeft == 0) {
			adapter.stop();
			callback(new Error('Could not initialize due to too many Hardware Errors'));
			return;
		}
		--initTriesLeft;
		
		var queue = [
			function() {
				adapter.reset(function(status) {
					if (status != 0) {
						fail("Reset", status);
						return;
					}
					cont();
				});
			},
			function() {
				if (ownAddressType == 'random') {
					adapter.leSetRandomAddress(staticRandomAddress, function(status) {
						if (status != 0) {
							fail("Set Random Address", status);
							return;
						}
						cont();
					});
				} else {
					adapter.readBdAddr(function(status, bdAddr) {
						if (status != 0) {
							fail("Read BD_ADDR", status);
							return;
						}
						if (ownAddressType == 'public') {
							controllerBdAddr = bdAddr;
						}
						cont();
					});
				}
			},
			function() {
				adapter.leClearWhiteList(function(status) {
					if (status != 0) {
						fail("LE Clear White List", status);
						return;
					}
					cont();
				});
			},
			function() {
				adapter.leReadWhiteListSize(function(status, size) {
					if (status != 0) {
						fail("LE Read White List Size", status);
						return;
					}
					whiteListSize = size;
					cont();
				});
			},
			function() {
				var eventMaskLow = 0, eventMaskHigh = 0;
				eventMaskLow |= (1 << 4); // Disconnection Complete Event
				eventMaskLow |= (1 << 7); // Encryption Change Event
				eventMaskLow |= (1 << 15); // Hardware Error Event
				eventMaskHigh |= (1 << (47 - 32)); // Encryption Key Refresh Complete Event
				eventMaskHigh |= (1 << (61 - 32)); // LE Meta Event
				adapter.setEventMask(eventMaskLow, eventMaskHigh, function(status) {
					if (status != 0) {
						fail("Set Event Mask", status);
						return;
					}
					cont();
				});
			},
			function() {
				var leEventMaskLow = 0, leEventMaskHigh = 0;
				leEventMaskLow |= (1 << 0); // LE Connection Complete Event
				leEventMaskLow |= (1 << 1); // LE Advertising Report Event
				leEventMaskLow |= (1 << 2); // LE Connection Update Complete Event
				leEventMaskLow |= (1 << 3); // LE Read Remote Features Complete Event
				leEventMaskLow |= (1 << 4); // LE Long Term Key Request Event
				adapter.leSetEventMask(leEventMaskLow, leEventMaskHigh, function(status) {
					if (status != 0) {
						fail("Set Event Mask", status);
						return;
					}
					cont();
				});
			},
			function() {
				adapter.leReadBufferSize(function(status, packetLength, numPackets) {
					if (status != 0) {
						fail("LE Read Buffer Size", status);
						return;
					}
					if (packetLength != 0) {
						queue.shift();
					}
					cont();
				});
			},
			function() {
				adapter.readBufferSize(function(status, aclPacketLength, syncPacketLength, numAclPackets, numSyncPackets) {
					if (status != 0) {
						fail("Read Buffer Size", status);
						return;
					}
					cont();
				});
			},
			function() {
				adapter.leReadSupportedStates(function(status, low, high) {
					if (status != 0) {
						fail("Read Supported States", status);
						return;
					}
					leSupportedStates = Array(11);
					for (var s1 = 0; s1 < 11; s1++) {
						leSupportedStates[s1] = Array(10).fill(false);
					}
					[
						[STATE_NONE, STATE_NONCONN_ADV],
						[STATE_NONE, STATE_SCANNABLE_ADV],
						[STATE_NONE, STATE_CONNECTABLE_ADV],
						[STATE_NONE, STATE_HIGH_DUTY_DIR_ADV],
						[STATE_NONE, STATE_PASSIVE_SCANNING],
						[STATE_NONE, STATE_ACTIVE_SCANNING],
						[STATE_NONE, STATE_INITIATING],
						[STATE_NONE, STATE_SLAVE],
						
						[STATE_NONCONN_ADV, STATE_PASSIVE_SCANNING],
						[STATE_SCANNABLE_ADV, STATE_PASSIVE_SCANNING],
						[STATE_CONNECTABLE_ADV, STATE_PASSIVE_SCANNING],
						[STATE_HIGH_DUTY_DIR_ADV, STATE_PASSIVE_SCANNING],
						[STATE_NONCONN_ADV, STATE_ACTIVE_SCANNING],
						[STATE_SCANNABLE_ADV, STATE_ACTIVE_SCANNING],
						[STATE_CONNECTABLE_ADV, STATE_ACTIVE_SCANNING],
						[STATE_HIGH_DUTY_DIR_ADV, STATE_ACTIVE_SCANNING],
						
						[STATE_NONCONN_ADV, STATE_INITIATING],
						[STATE_SCANNABLE_ADV, STATE_INITIATING],
						[STATE_NONCONN_ADV, STATE_MASTER],
						[STATE_SCANNABLE_ADV, STATE_MASTER],
						[STATE_NONCONN_ADV, STATE_SLAVE],
						[STATE_SCANNABLE_ADV, STATE_SLAVE],
						[STATE_PASSIVE_SCANNING, STATE_INITIATING],
						[STATE_ACTIVE_SCANNING, STATE_INITIATING],
						
						[STATE_PASSIVE_SCANNING, STATE_MASTER],
						[STATE_ACTIVE_SCANNING, STATE_MASTER],
						[STATE_PASSIVE_SCANNING, STATE_SLAVE],
						[STATE_ACTIVE_SCANNING, STATE_SLAVE],
						[STATE_INITIATING, STATE_MASTER],
						[STATE_NONE, STATE_LOW_DUTY_DIR_ADV],
						[STATE_LOW_DUTY_DIR_ADV, STATE_PASSIVE_SCANNING],
						[STATE_LOW_DUTY_DIR_ADV, STATE_ACTIVE_SCANNING],
						
						[STATE_CONNECTABLE_ADV, STATE_INITIATING],
						[STATE_HIGH_DUTY_DIR_ADV, STATE_INITIATING],
						[STATE_LOW_DUTY_DIR_ADV, STATE_INITIATING],
						[STATE_CONNECTABLE_ADV, STATE_MASTER],
						[STATE_HIGH_DUTY_DIR_ADV, STATE_MASTER],
						[STATE_LOW_DUTY_DIR_ADV, STATE_MASTER],
						[STATE_CONNECTABLE_ADV, STATE_SLAVE],
						[STATE_HIGH_DUTY_DIR_ADV, STATE_SLAVE],
						
						[STATE_LOW_DUTY_DIR_ADV, STATE_SLAVE],
						[STATE_INITIATING, STATE_SLAVE]
					].forEach(function(combination, i) {
						if ((i < 32 && (low & (1 << i))) || (i >= 32 && (high & (1 << (i - 32))))) {
							leSupportedStates[combination[0]][combination[1]] = true;
							if (combination[0] != STATE_NONE) {
								leSupportedStates[combination[1]][combination[0]] = true;
							}
						}
					});
					cont();
				});
			}
		];
		
		cont();
		
		function cont() {
			var fn = queue.shift();
			if (fn) {
				fn();
			} else {
				initComplete = true;
				callback(null, manager);
			}
		}
	}
	
	function sortWhiteListAndRemoveDuplicates(list) {
		if (list.length == 0) {
			return;
		}
		list.sort();
		var i = 1, j = 0;
		for (; i < list.length; i++) {
			if (list[j] != list[i]) {
				list[++j] = list[i];
			}
		}
		list.length = j + 1;
	}
	
	// newList must be sorted
	function updateWhiteList(newList, callback) {
		var adds = [];
		var removals = [];
		var keep = [];
		var i, j;
		for (i = 0, j = 0; i < currentWhiteList.length && j < newList.length;) {
			var a = currentWhiteList[i], b = newList[j];
			if (a == b) {
				++i, ++j;
				keep.push(a);
			} else if (a < b) {
				++i;
				removals.push(a);
			} else {
				++j;
				adds.push(b);
			}
		}
		for (; i < currentWhiteList.length; ++i) {
			removals.push(currentWhiteList[i]);
		}
		for (; j < newList.length; ++j) {
			adds.push(newList[j]);
		}
		var doClear = false;
		if (1 + keep.length <= removals.length) {
			doClear = true;
			removals = [];
			adds = keep.concat(adds);
		}
		var cnt = (doClear ? 1 : 0) + removals.length + adds.length;
		var ops = (doClear ? [function(cb) {
			adapter.leClearWhiteList(cb);
		}] : []).concat(removals.map((a, i) => function(cb) {
			adapter.leRemoveDeviceFromWhiteList(parseInt(a), a.substr(3), cb);
		})).concat(adds.map((a, i) => function(cb) {
			adapter.leAddDeviceToWhiteList(parseInt(a), a.substr(3), cb);
		}));
		
		cont(0);
		function cont(i) {
			if (i == ops.length) {
				currentWhiteList = newList;
				callback(null);
			} else {
				ops[i](function(status) {
					if (status != 0) {
						adapter.leClearWhiteList(function(status2) {
							currentWhiteList = [];
							callback(new Error("Couldn't modify white list: " + Errors.toString(status)));
						});
					} else {
						cont(i + 1);
					}
				});
			}
		}
		
	}
	
	function scanningFailed(msg) {
		// TODO
		throw new Error("scanning failed: " + msg);
	}
	
	function calcScanParameters(pArr) {
		var highestDuty = 0;
		var scanWindow = 16;
		var scanInterval = 16;
		for (var i = 0; i < pArr.length; i++) {
			var sp = pArr[i];
			var thisDuty = sp.scanWindow / sp.scanInterval;
			if (thisDuty > highestDuty || (thisDuty == highestDuty && sp.scanWindow < scanWindow)) {
				highestDuty = thisDuty;
				scanWindow = sp.scanWindow;
				scanInterval = sp.scanInterval;
			}
		}
		return {scanWindow: scanWindow, scanInterval: scanInterval};
	}
	
	function triggerScannerChange() {
		if (scannerCommandInProgress || connectingExplicitly) {
			return;
		}
		
		if (scanEnabled && (isEmpty(scanners) || scanningNeedsRestart || stopScanCallback)) {
			scannerCommandInProgress = true;
			adapter.leSetScanEnable(false, false, null, function(status) {
				// Stopping scan should always succeed. If it for some reason doesn't, assume scan is already stopped.
				scannerCommandInProgress = false;
				scanEnabled = false;
				if (whiteListUsage == WHITE_LIST_USAGE_SCANNER) {
					whiteListUsage = null;
				}
				triggerScannerChange();
			});
			return;
		}
		
		scanningNeedsRestart = false;
		
		if (stopScanCallback) {
			var cb = stopScanCallback;
			stopScanCallback = null;
			cb();
			return;
		}
		
		if (!isEmpty(scanners)) {
			var scannerArr = Object.keys(scanners).map(k => scanners[k]);
			var leScanType = scannerArr.some(s => s.activeScan) ? 0x01 : 0x00;
			var useWhiteList = whiteListUsage == null && scannerArr.every(s => s.scanFilters && s.scanFilters.every(f => f instanceof BdAddrScanFilter));
			var sp = calcScanParameters(scannerArr.map(s => s.scanParameters).filter(p => p));
			var scanWindow = sp.scanWindow;
			var scanInterval = sp.scanInterval;
			
			var targetWhiteList;
			var mustUpdateWhiteList = false;
			if (useWhiteList) {
				targetWhiteList = [];
				scannerArr.forEach(s => {
					s.scanFilters.forEach(f => {
						targetWhiteList.push(f.combinedAddress);
					});
				});
				sortWhiteListAndRemoveDuplicates(targetWhiteList);
				if (targetWhiteList > whiteListSize) {
					useWhiteList = false;
				} else {
					mustUpdateWhiteList = !arraysAreEqual(currentWhiteList, targetWhiteList);
				}
			}
			
			var csp = currentScanParameters;
			var scanParametersChanged = csp.leScanType != leScanType || csp.leScanInterval != scanInterval || csp.leScanWindow != scanWindow || csp.scanningFilterPolicy != (useWhiteList ? 0x01 : 0x00);
			if (scanParametersChanged || mustUpdateWhiteList) {
				if (scanEnabled) {
					scanningNeedsRestart = true;
					triggerScannerChange();
					return;
				}
				if (useWhiteList) {
					whiteListUsage = WHITE_LIST_USAGE_SCANNER;
				}
				if (scanParametersChanged) {
					scannerCommandInProgress = true;
					adapter.leSetScanParameters(leScanType, scanInterval, scanWindow, ownAddressType == "public" ? 0 : 1, useWhiteList ? 0x01 : 0x00, function(status) {
						scannerCommandInProgress = false;
						if (status != 0) {
							scanningFailed("Could not set scan parameters: " + Errors.toString(status));
						} else {
							currentScanParameters.leScanType = leScanType;
							currentScanParameters.leScanInterval = scanInterval;
							currentScanParameters.leScanWindow = scanWindow;
							currentScanParameters.scanningFilterPolicy = (useWhiteList ? 0x01 : 0x00);
							contWhiteList();
						}
					});
					return;
				}
				contWhiteList();
				function contWhiteList() {
					if (mustUpdateWhiteList) {
						scannerCommandInProgress = true;
						updateWhiteList(targetWhiteList, function(error) {
							scannerCommandInProgress = false;
							if (error) {
								scanningFailed("Could not update white list");
							} else {
								contAfterWhiteList();
							}
						});
						return;
					}
					contAfterWhiteList();
				}
			} else if (!scanEnabled) {
				contAfterWhiteList();
			}
			function contAfterWhiteList() {
				currentScanFilterDuplicates = scannerArr.every(s => !s.activeScan && s.filterDuplicates); // At least on RPi3 and rtl8723bs filtering duplicates sometimes misses the SCAN_RSP
				scannerCommandInProgress = true;
				adapter.leSetScanEnable(true, currentScanFilterDuplicates, handleAdvReport, function(status) {
					scannerCommandInProgress = false;
					if (status != 0) {
						scanningFailed("Could not start scan: " + Errors.toString(status));
					} else {
						scanEnabled = true;
						triggerScannerChange(); // In case something changed in the meantime we enabled scan
					}
				});
			}
		}
	}
	
	function handleAdvReport(eventType, addressType, address, data, rssi) {
		Object.keys(scanners).map(k => scanners[k]).forEach(scanner => {
			if (scanner.filterDuplicates && scanner.duplicateCache.isDuplicate(addressType + address)) {
				return;
			}
			if (scanner.activeScan) {
				// Extra check to not fill advDataCache if definitely not needed
				if (scanner.scanFilters && scanner.scanFilters.every(f => (f instanceof BdAddrScanFilter) && !(parseInt(f.combinedAddress) == addressType && f.combinedAddress.substr(3) == address))) {
					return;
				}
				if (eventType == 0x00 || eventType == 0x02) {
					// ADV_IND or ADV_SCAN_IND
					scanner.advDataCache.add(addressType + address, {eventType: eventType, data: data});
					return;
				}
				if (eventType == 0x04) {
					// SCAN_RSP
					var cached = scanner.advDataCache.get(addressType + address);
					if (cached == null) {
						// Drop since we don't have both parts
						return;
					}
					scanner.advDataCache.remove(addressType + address);
					
					eventType = cached.eventType;
					data = Buffer.concat([cached.data, data]);
				}
			} else if (eventType == 0x04) {
				// Passive scan and SCAN_RSP, so ignore
				return;
			}
			
			var dataItems = []; // {type, data}
			for (var pos = 0; pos < data.length;) {
				var len = data[pos++];
				if (len == 0 || pos >= data.length) {
					continue;
				}
				--len;
				var type = data[pos++];
				dataItems.push({type: type, data: data.slice(pos, pos + len)});
				pos += len;
			}
			var parsed = {};
			dataItems.forEach(function(item) {
				var buf = item.data;
				function parseUuid(i, len) {
					if (len != 16) {
						var val = buf[i] | (buf[i + 1] << 8);
						if (len == 4) {
							val |= (buf[i + 2] << 16) | (buf[i + 3] << 24);
							val >>>= 0; // Make it unsigned
						}
						return (0x100000000 + val).toString(16).substr(-8).toUpperCase() + BASE_UUID_SECOND_PART;
					} else {
						var uuid = Buffer.from(buf.slice(i, i + 16)).reverse().toString('hex').toUpperCase();
						return uuid.substr(0, 8) + '-' + uuid.substr(8, 4) + '-' + uuid.substr(12, 4) + '-' + uuid.substr(16, 4) + '-' + uuid.substr(20, 12);
					}
				}
				function parseUuids(len) {
					var uuids = [];
					for (var i = 0; i + len <= buf.length; i += len) {
						uuids.push(parseUuid(i, len));
					}
					return uuids;
				}
				function parseBdAddr(pos) {
					var str = '';
					for (var i = 5; i >= 0; i--) {
						str += (0x100 + buffer[pos + i]).toString(16).substr(-2).toUpperCase();
						if (i != 0) {
							str += ':';
						}
					}
					pos += 6;
					return str;
				}
				function parseBdAddrs() {
					var addrs = [];
					for (var i = 0; i + 6 <= buf.length; i += 6) {
						addrs.push(parseBdAddr(pos));
					}
					return addrs;
				}
				switch (item.type) {
					case 0x01: // Flags
						parsed.flags = {
							leLimitedDiscoverableMode: !!(buf[0] & 1),
							leGeneralDiscoverableMode: !!(buf[0] & 2),
							brEdrNotSupported: !!(buf[0] & 4),
							simultaneousLeAndBdEdrToSameDeviceCapableController: !!(buf[0] & 8),
							simultaneousLeAndBrEdrToSameDeviceCapableHost: !!(buf[0] & 16),
							raw: Buffer.from(buf)
						};
						break;
					case 0x02: // Incomplete List of 16-bit Service Class UUIDs
					case 0x03: // Complete List of 16-bit Service Class UUIDs
					case 0x04: // Incomplete List of 32-bit Service Class UUIDs
					case 0x05: // Complete List of 32-bit Service Class UUIDs
					case 0x06: // Incomplete List of 128-bit Service Class UUIDs
					case 0x07: // Complete List of 128-bit Service Class UUIDs
						var len = item.type <= 0x03 ? 2 : item.type <= 0x05 ? 4 : 16;
						parseUuids(len).forEach(uuid => {
							//console.log('adding uuid ' + uuid);
							if (!parsed.hasOwnProperty('serviceUuids')) {
								parsed.serviceUuids = [];
							}
							if (!parsed.serviceUuids.some(s => s == uuid)) {
								parsed.serviceUuids.push(uuid);
							}
						});
						break;
					case 0x08: // Shortened Local Name
					case 0x09: // Complete Local Name
						if (!parsed.localName || item.type == 0x09) {
							parsed.localName = buf.toString();
							if (item.type == 0x08) {
								parsed.localName += "...";
							}
						}
						break;
					case 0x0a: // TX Power Level
						if (buf.length == 1) {
							 parsed.txPowerLevel = buf[0] >= 128 ? buf[0] - 256 : buf[0];
						}
						break;
					case 0x12: // Slave Connection Interval Range
						if (buf.length == 4) {
							var min = buf[0] | (buf[1] << 8);
							var max = buf[2] | (buf[2] << 8);
							parsed.slaveConnectionIntervalRange = {min: min, max: max};
						}
						break;
					case 0x14: // List of 16-bit Service Solicitation UUIDs
					case 0x1f: // List of 32-bit Service Solicitation UUIDs
					case 0x15: // List of 128-bit Service Solicitation UUIDs
						var len = item.type == 0x14 ? 2 : item.type == 0x1f ? 4 : 16;
						parseUuids(len).forEach(uuid => {
							if (!parsed.hasOwnProperty('serviceSolicitations')) {
								parsed.serviceSolicitations = [];
							}
							if (!parsed.serviceSolicitations.some(s => s == uuid)) {
								parsed.serviceSolicitations.push(uuid);
							}
						});
					case 0x16: // Service Data - 16-bit UUID
					case 0x20: // Service Data - 32-bit UUID
					case 0x21: // Service Data - 128-bit UUID
						var len = item.type == 0x16 ? 2 : item.type == 0x20 ? 4 : 16;
						if (buf.length >= len) {
							var uuid = parseUuid(0, len);
							if (!parsed.hasOwnProperty('serviceData')) {
								parsed.serviceData = [];
							}
							parsed.serviceData.push({uuid: uuid, data: Buffer.from(buf.slice(4))});
						}
						break;
					case 0x19: // Appearance
						if (buf.length == 2) {
							parsed.appearance = buf[0] | (buf[1] << 8); // TODO: human readable string?
						}
						break;
					case 0x17: // Public Target Address
						parsed.publicTargetAddresses = parseBdAddrs();
						break;
					case 0x18: // Random Target Address
						parsed.randomTargetAddresses = parseBdAddrs();
						break;
					case 0x1a: // Advertising Interval
						if (buf.length == 2) {
							parsed.advertisingInterval = buf[0] | (buf[1] << 8);
						}
						break;
					case 0x24: // URI
						parsed.uri = buf.toString();
						break;
					case 0x27: // LE Supported Features
						var low = 0, high = 0;
						for (var i = 0; i < 8; i++) {
							if (i < 4) {
								low |= buf[i] << (i * 8);
							} else {
								high |= buf[i] << ((i - 4) * 8);
							}
						}
						// Make unsigned
						low >>>= 0;
						high >>>= 0;
						parsed.leSupportedFeatures = {low: low, high: high};
						break;
					case 0xff: // Manufacturer Specific Data
						if (buf.length >= 2) {
							var company = buf[0] | (buf[1] << 8);
							var manufacturerSpecificData = Buffer.from(buf.slice(2));
							if (!parsed.hasOwnProperty('manufacturerSpecificData')) {
								parsed.manufacturerSpecificData = [];
							}
							parsed.manufacturerSpecificData.push({companyIdentifierCode: company, data: manufacturerSpecificData});
						}
						break;
				}
			});
			
			if (scanner.scanFilters && !scanner.scanFilters.some(f => {
				if (f instanceof BdAddrScanFilter) {
					return parseInt(f.combinedAddress) == addressType && f.combinedAddress.substr(3) == address;
				}
				if (f instanceof ServiceUUIDScanFilter) {
					if (!parsed.serviceUuids) {
						//console.log('no service uuids');
					} else {
						//console.log('comparing', f.uuid, parsed.serviceUuids);
					}
					return parsed.serviceUuids && parsed.serviceUuids.some(uuid => uuid == f.uuid);
				}
				return false;
			})) {
				return;
			}
			
			if (!scanner.filterDuplicates || scanner.duplicateCache.add(addressType + address)) {
				var eventData = {
					connectable: eventType <= 0x01,
					addressType: addressType == 0x00 ? "public" : "random",
					address: address,
					rawDataItems: dataItems,
					parsedDataItems: parsed,
					rssi: rssi
				};
				if (!scanner.stopped) {
					scanner.scanner.emit('report', eventData);
				}
			}
		});
	}
	
	function onConnected(role, aclConn, pendingConn, connectedCallback, peerAddressType, peerAddress, connInterval, connLatency, supervisionTimeout, masterClockAccuracy) {
		var conn = new Connection();
		
		var ignoringIncomingData = false;
		var disconnectInitiated = false;
		var disconnected = false;
		
		var peerIdentityAddressType = null;
		var peerIdentityAddress = null;
		
		Object.defineProperty(conn, 'ownAddressType', {enumerable: true, configurable: false, writable: false, value: ownAddressType});
		Object.defineProperty(conn, 'ownAddress', {enumerable: true, configurable: false, writable: false, value: controllerBdAddr});
		
		Object.defineProperty(conn, 'peerAddressType', {enumerable: true, configurable: false, writable: false, value: peerAddressType});
		Object.defineProperty(conn, 'peerAddress', {enumerable: true, configurable: false, writable: false, value: peerAddress});
		
		Object.defineProperty(conn, 'peerIdentityAddressType', {enumerable: true, configurable: false, get: () => peerIdentityAddressType});
		Object.defineProperty(conn, 'peerIdentityAddress', {enumerable: true, configurable: false, get: () => peerIdentityAddress});
		
		Object.defineProperty(conn, 'disconnectInitiated', {enumerable: true, configurable: false, get: () => disconnectInitiated});
		Object.defineProperty(conn, 'disconnected', {enumerable: true, configurable: false, get: () => disconnected});
		
		Object.defineProperty(conn, 'id', {enumerable: true, configurable: false, writable: false, value: idGenerator.next()});
		
		connections[conn.id] = conn;
		
		var timeouts = Object.create(null);
		Object.defineProperty(conn, 'setTimeout', {enumerable: true, configurable: false, writable: false, value: function(callback, milliseconds) {
			callback = fixCallback(conn, callback);
			if (disconnected) {
				return function() {};
			}
			var id = idGenerator.next();
			timeouts[id] = manager.setTimeout(function() {
				delete timeouts[id];
				callback();
			}, milliseconds);
			return function() {
				if (id in timeouts) {
					timeouts[id]();
					delete timeouts[id];
				}
			};
		}});

		(function() {
			var firstChar = parseInt(conn.peerAddress.charAt(0), 16);
			var ownAddressLong = storage.constructAddress(conn.ownAddressType, conn.ownAddress);
			var peerAddressLong = storage.constructAddress(conn.peerAddressType, conn.peerAddress);
			if (conn.peerAddressType == 'random' && firstChar >= 4 && firstChar <= 7) {
				// Random resolvable
				var resolved = storage.resolveAddress(ownAddressLong, peerAddressLong);
				if (resolved) {
					peerIdentityAddressType = resolved.substr(0, 2) == '00' ? 'public' : 'random';
					peerIdentityAddress = resolved.substr(3);
				}
			} else if (conn.peerAddressType == 'public' || firstChar >= 12) {
				peerIdentityAddressType = conn.peerAddressType;
				peerIdentityAddress = conn.peerAddress;
			}
			
		})();
		
		Object.defineProperty(conn, 'disconnect', {enumerable: true, configurable: false, writable: false, value: function(reason, startIgnoreIncomingData) {
			switch (reason) {
				case Errors.HCI_AUTHENTICATION_FAILURE:
				case Errors.HCI_OE_USER_ENDED_CONNECTION:
				case Errors.HCI_OE_LOW_RESOURCES:
				case Errors.HCI_OE_POWER_OFF:
				case Errors.HCI_UNACCEPTABLE_CONN_INTERV:
					break;
				default:
					reason = Errors.HCI_OE_USER_ENDED_CONNECTION;
			}
			if (startIgnoreIncomingData) {
				ignoringIncomingData = true;
			}
			if (disconnectInitiated || disconnected) {
				return;
			}
			disconnectInitiated = true;
			adapter.disconnect(aclConn.handle, reason);
		}});
		
		Object.defineProperty(conn, 'readRssi', {enumerable: true, configurable: false, writable: false, value: function(callback) {
			callback = fixCallback(conn, callback);
			if (!disconnected) {
				adapter.readRssi(aclConn.handle, callback);
			}
		}});
		
		var connUpdateQueue = new Queue();
		var connParamUpdateHook = null;
		var nextConnParamUpdate = function() {
			var index = connUpdateQueue.getLength() - 1;
			if (index < 0) {
				return;
			}
			var parameters = connUpdateQueue.getAt(index);
			if (!role) {
				// Master
				var triesLeft = [1000, 5000, 10000];
				run();
				function run() {
					if (disconnected || disconnectInitiated) {
						// Ignore request since the disconnected event will come soon anyway (unless it already has come)
						return;
					}
					adapter.leConnectionUpdate(aclConn.handle, parameters.connIntervalMin, parameters.connIntervalMax, parameters.connLatency, parameters.supervisionTimeout, parameters.minimumCELength, parameters.maximumCELength, function(status) {
						if (disconnected) {
							return;
						}
						if (status != 0) {
							// Failed, this might be due to controller is somehow busy,
							// which happens sometimes on Realtek controllers,
							// or because it disconnected.
							var timeout = triesLeft.shift();
							if (timeout) {
								manager.setTimeout(function() {
									if (!disconnected) {
										if (index == connUpdateQueue.getLength() - 1) {
											run();
										} else {
											// Go directly and try the new parameters
											nextConnParamUpdate();
										}
									}
								}, timeout);
								return;
							}
						}
						for (var i = 0; i <= index; i++) {
							connUpdateQueue.peek().callback(status);
							connUpdateQueue.shift();
						}
						nextConnParamUpdate();
					});
				}
			} else {
				// Slave
				if (disconnected) {
					return;
				}
				
				// This implementation enqueues all requests and executes them in serial.
				// Before the next request can be executed, the previous must either:
				// - Timed out (the l2cap RTX)
				// - Been rejected
				// - Accepted and either an update complete received from the controller or 30 seconds have passed
				// In case of accepted, the callback to the user is called immediately on accepted.
				// The user can listen to the connectionUpdate event to detect when the update actually takes place (if it does, which is not for sure)
				var data = Buffer.alloc(8);
				data.writeUInt16LE(parameters.connIntervalMin, 0);
				data.writeUInt16LE(parameters.connIntervalMax, 2);
				data.writeUInt16LE(parameters.connLatency, 4);
				data.writeUInt16LE(parameters.supervisionTimeout, 6);
				
				var cnt = 2;
				var timeoutClearFn = function() {};
				var accept;
				
				var done = function(response) {
					connParamUpdateHook = null;
					timeoutClearFn();
					for (var i = 0; i <= index; i++) {
						connUpdateQueue.peek().callback(i < index ? -2 : response);
						connUpdateQueue.shift();
					}
					nextConnParamUpdate();
				};
				
				connParamUpdateHook = function() {
					connParamUpdateHook = null;
					if (--cnt == 0) {
						done(accept ? 0 : 1);
					}
				};
				
				l2capSignalingSendRequest(L2CAP_SIG_CONNECTION_PARAMETER_UPDATE_REQUEST, data, function(responseData) {
					accept = responseData.equals(Buffer.alloc(2));
					if (--cnt == 0 || !accept) {
						done(accept ? 0 : 1);
					} else {
						// Timeout for waiting for the indication of that the parameters were actually updated
						timeoutClearFn = conn.setTimeout(function() {
							done(accept ? 0 : 1);
						}, 30000);
					}
				}, function() {
					// Timeout handler when no L2CAP response arrives
					done(-1);
				});
			}
		};
		Object.defineProperty(conn, 'updateConnParams', {enumerable: true, configurable: false, writable: false, value: function(parameters, callback) {
			parameters = validateConnectionParameters(parameters);
			parameters = makeConnParamsValid(parameters);
			callback = fixCallback(conn, callback);
			
			parameters.callback = callback;
			
			if (disconnected) {
				return;
			}
			
			connUpdateQueue.push(parameters);
			
			if (connUpdateQueue.getLength() == 1) {
				nextConnParamUpdate();
			}
			
		}});
		
		var cids = Object.create(null);
		
		var l2capSignalingSendRequest;
		var l2capSignalingOnData;
		(function () {
			var activeIdentifiers = Object.create(null);
			var nextIdentifier = 1;
			
			var cocLePsmRegistry = Object.create(null); // lePsm -> request callback
			var cocMap = Object.create(null); // {rxCid, txCid, txMps, rxMps, txMtu, rxMtu, txCredits, rxCredits, incomingPackets, rxSduBytesLeft, isPaused, isInDataCallback,
			                                  // outgoingPackets, hasPendingOutgoingPacket, isActive, isWaitingForDisconnectResponse, userObj}
			var txCidToRxCid = Object.create(null);
			var numCoc = 0;
			
			function allocateIdentifier() {
				// FIXME: if it wraps around and a command is still pending, maybe don't just reuse it
				var identifier = nextIdentifier++;
				if (nextIdentifier == 256) {
					nextIdentifier = 1;
				}
				return identifier;
			}
			
			function triggerCocSend(obj) {
				if (!obj.hasPendingOutgoingPacket && obj.outgoingPackets.getLength() > 0 && obj.txCredits > 0 && !conn.disconnected && obj.isActive) {
					--obj.txCredits;
					obj.hasPendingOutgoingPacket = true;
					var p = obj.outgoingPackets.shift();
					adapter.sendData(aclConn.handle, obj.txCid, p.data, function() {
						obj.hasPendingOutgoingPacket = false;
						// Call callback before we continue, otherwise the recursion may lead to that the sentCallbacks are called in reverse order
						if (p.sentCallback) {
							p.sentCallback();
						}
						triggerCocSend(obj);
					}, p.completeCallback);
				}
			}
			
			function handleCocIncomingPackets(obj) {
				while (!obj.isPaused && !obj.isInDataCallback && obj.incomingPackets.getLength() - (obj.rxSduBytesLeft ? 1 : 0) > 0) {
					var sdu = Buffer.concat(obj.incomingPackets.shift());
					obj.isInDataCallback = true;
					obj.userObj.emit('data', sdu);
					obj.isInDataCallback = false;
				}
				
				// Send new credits if needed
				if (obj.rxCredits <= 70 && !obj.isPaused && obj.isActive && !conn.disconnected) {
					obj.rxCredits += 500;
					var buf = Buffer.alloc(4);
					buf.writeUInt16LE(obj.rxCid, 0);
					buf.writeUInt16LE(500, 2);
					sendSignalingPacket(L2CAP_SIG_LE_FLOW_CONTROL_CREDIT, nextIdentifier, buf);
				}
			}
			
			function disconnectCoc(obj) {
				if (obj.isActive && !conn.disconnected) {
					var buf = Buffer.alloc(4);
					buf.writeUInt16LE(obj.txCid, 0);
					buf.writeUInt16LE(obj.rxCid, 2);
					
					var done = function() {
						if (!obj.isWaitingForDisconnectResponse) {
							// Already handled finalisation of disconnect due to the peer sent an own disconnect request
							return;
						}
						--numCoc;
						delete txCidToRxCid[obj.txCid];
						delete cocMap[obj.rxCid];
						obj.isWaitingForDisconnectResponse = false;
					};
					
					obj.isActive = false;
					delete cids[obj.rxCid];
					obj.isWaitingForDisconnectResponse = true;
					l2capSignalingSendRequest(L2CAP_SIG_DISCONNECTION_REQUEST, buf, function(responseData) {
						if (!responseData.equals(buf)) {
							// Silently discard, per specification
							return;
						}
						done();
					}, function() {
						done();
					});
					obj.userObj.emit('disconnect');
				}
			}
			
			function L2CAPCoC(obj) {
				EventEmitter.call(this);
				
				cids[obj.rxCid] = function(data) {
					if (obj.rxCredits == 0 || (obj.rxSduBytesLeft == 0 && data.length < 2)) {
						disconnect();
						return;
					}
					--obj.rxCredits;
					
					if (obj.rxSduBytesLeft == 0) {
						// Start of packet
						obj.rxSduBytesLeft = data.readUInt16LE(0);
						obj.incomingPackets.push([]);
						data = data.slice(2);
					}
					if (data.length > obj.rxSduBytesLeft || data.length > obj.rxMps || obj.rxSduBytesLeft > obj.rxMtu) {
						disconnect();
						return;
					}
					var arr = obj.incomingPackets.getAt(obj.incomingPackets.getLength() - 1);
					arr.push(data);
					obj.rxSduBytesLeft -= data.length;
					handleCocIncomingPackets(obj);
				};
				
				this.send = function(sdu, sentCallback, completeCallback) {
					validate(sdu instanceof Buffer, 'The sdu must be a Buffer');
					validate(sdu.length <= obj.txMtu, 'The sdu cannot be larger than the txMtu');
					sentCallback = fixCallback(this, sentCallback);
					completeCallback = fixCallback(this, completeCallback);
					
					if (conn.disconnected || !obj.isActive) {
						return;
					}
					
					sdu = Buffer.from(sdu); // To avoid the buffer being changed while it is in the queue
					
					var packets = [];
					
					var header = Buffer.alloc(2);
					header.writeUInt16LE(sdu.length, 0);
					var firstPacket = Buffer.concat([header, sdu.slice(0, obj.txMps - 2)]); // Some implementations only accept mps - 2 in the first packet
					packets.push(firstPacket);
					for (var pos = obj.txMps - 2; pos < sdu.length; pos += obj.txMps) {
						packets.push(sdu.slice(pos, pos + obj.txMps));
					}
					
					for (var i = 0; i < packets.length; i++) {
						var isLast = i == packets.length - 1;
						obj.outgoingPackets.push({data: packets[i], sentCallback: isLast ? sentCallback : null, completeCallback: isLast ? completeCallback : null});
					}
					triggerCocSend(obj);
				};
				
				this.disconnect = function() {
					disconnectCoc(obj);
				};
				
				this.pause = function() {
					obj.isPaused = true;
				};
				
				this.resume = function() {
					obj.isPaused = false;
					handleCocIncomingPackets(obj);
				};
				
				Object.defineProperty(this, 'txMps', {enumerable: true, configurable: false, writable: false, value: obj.txMps});
				Object.defineProperty(this, 'txMtu', {enumerable: true, configurable: false, writable: false, value: obj.txMtu});
				Object.defineProperty(this, 'txCredits', {enumerable: true, configurable: false, get: () => obj.txCredits - obj.outgoingPackets.getLength()});
				Object.defineProperty(this, 'disconnected', {enumerable: true, configurable: false, get: () => !obj.isActive});
			};
			util.inherits(L2CAPCoC, EventEmitter);
			
			l2capSignalingOnData = function(data) {
				if (data.length < 4) {
					// It's not defined by the spec how this should be handled, so just drop it
					return;
				}
				var code = data[0];
				var identifier = data[1];
				var length = data.readUInt16LE(2);
				if (4 + length != data.length) {
					// Invalid packet
					return;
				}
				if (data.length > 23) {
					// It's a bit unclear if we should reject the packet due to bad MTU or
					// silently ignore it if it is a response packet but with an invalid identifier.
					sendSignalingPacketReject(identifier, 0x0001, Buffer.from([23, 0])); // Signaling MTU exceeded
					return;
				}
				if (code == 0x00 || (code >= 0x02 && code <= 0x05) || (code >= 0x08 && code <= 0x11) || code >= 0x17 || (code == L2CAP_SIG_CONNECTION_PARAMETER_UPDATE_REQUEST && role)) {
					// Unknown or disallowed on this channel, so reject
					sendSignalingPacketReject(identifier, 0x0000, Buffer.alloc(0)); // Command not understood
					return;
				}
				data = data.slice(4);
				if (code & 1) {
					// Is response
					var request = activeIdentifiers[identifier];
					if (!request || (code != request.responseCode && code != L2CAP_SIG_COMMAND_REJECT)) {
						// Silently ignore, per specification
						return;
					}
					delete activeIdentifiers[identifier];
					request.timeoutClearFn();
					if (code != L2CAP_SIG_COMMAND_REJECT) {
						request.callback(data);
					} else {
						// For now treat a rejected command as a timeout
						if (request.timeoutFunction) {
							request.timeoutFunction();
						}
					}
					return;
				}
				if (code == L2CAP_SIG_CONNECTION_PARAMETER_UPDATE_REQUEST) {
					// Already verified we are not slave
					if (data.length != 8) {
						return;
					}
					var parameters = {
						connIntervalMin: data.readUInt16LE(0),
						connIntervalMax: data.readUInt16LE(2),
						connLatency: data.readUInt16LE(4),
						supervisionTimeout: data.readUInt16LE(6),
						minimumCELength: 0,
						maximumCELength: 0
					};
					
					var used = false;
					var cb = function(accept) {
						if (!used) {
							used = true;
							sendSignalingPacket(code + 1, identifier, Buffer.from([accept ? 0 : 1, 0]));
						}
					};
					
					try {
						validateConnectionParameters(parameters);
					} catch (e) {
						cb(false);
						return;
					}
					
					if (conn.listenerCount('updateConnParamsRequest') > 0) {
						conn.emit('updateConnParamsRequest', parameters, cb);
					} else {
						cb(true);
						conn.updateConnParams(parameters);
					}
					return;
				}
				if (code == L2CAP_SIG_LE_CREDIT_BASED_CONNECTION_REQUEST) {
					if (data.length != 10) {
						return;
					}
					var sendResult = function(dcid, mtu, mps, initialCredits, result) {
						var rsp = Buffer.alloc(10);
						rsp.writeUInt16LE(dcid, 0);
						rsp.writeUInt16LE(mtu, 2);
						rsp.writeUInt16LE(mps, 4);
						rsp.writeUInt16LE(initialCredits, 6);
						rsp.writeUInt16LE(result, 8);
						sendSignalingPacket(code + 1, identifier, rsp);
					};
					var lePsm = data.readUInt16LE(0);
					var scid = data.readUInt16LE(2);
					var txMtu = data.readUInt16LE(4);
					var mps = data.readUInt16LE(6);
					var initialCredits = data.readUInt16LE(8);
					if (txMtu < 23 || mps < 23 || mps > 65533) {
						sendResult(0, 0, 0, 0, L2CAPCoCErrors.UNACCEPTABLE_PARAMETERS);
						return;
					}
					mps = Math.min(mps, 1004); // Even if peer supports larger MPS, don't use it
					if (numCoc == 0xffc0) {
						sendResult(0, 0, 0, 0, L2CAPCoCErrors.NO_RESOURCES_AVAILABLE);
						return;
					}
					if (scid <= 0x003f) {
						sendResult(0, 0, 0, 0, L2CAPCoCErrors.INVALID_SOURCE_CID);
						return;
					}
					for (var cid in cocMap) {
						if (cocMap[cid].txCid == scid) {
							sendResult(0, 0, 0, 0, L2CAPCoCErrors.SOURCE_CID_ALREADY_ALLOCATED);
							return;
						}
					}
					var rxCid;
					for (rxCid = 0x40; ; ++rxCid) {
						if (!(rxCid in cocMap)) {
							break;
						}
					}
					cocMap[rxCid] = {
						rxCid: rxCid,
						txCid: scid,
						txMps: mps,
						rxMps: 0,
						txMtu: txMtu,
						rxMtu: 0,
						txCredits: initialCredits,
						rxCredits: 0,
						incomingPackets: new Queue(),
						rxSduBytesLeft: 0,
						isPaused: false,
						isInDataCallback: false,
						outgoingPackets: new Queue(),
						hasPendingOutgoingPacket: false,
						isActive: false,
						isWaitingForDisconnectResponse: false,
						userObj: null
					};
					++numCoc;
					
					var used = false;
					var callback = function(result, initiallyPaused, rxMtu) {
						validate(Number.isInteger(result) && result < 12 && result != 1 && result != 3, 'Invalid result code');
						validate(!used, 'Cannot accept COC request more than once');
						used = true;
						if (result != L2CAPCoCErrors.CONNECTION_SUCCESSFUL) {
							--numCoc;
							delete cocMap[rxCid];
							sendResult(0, 0, 0, 0, result);
							return;
						}
						validate(typeof rxMtu === 'undefined' || (Number.isInteger(rxMtu) && rxMtu >= 23 && rxMtu <= 65535), 'Invalid rxMtu');
						if (!rxMtu) {
							rxMtu = 65535;
						}
						var obj = cocMap[rxCid];
						obj.rxMtu = rxMtu;
						obj.rxMps = Math.min(rxMtu, 1004);
						obj.rxCredits = initiallyPaused ? 0 : 500;
						obj.isActive = true;
						obj.userObj = new L2CAPCoC(obj);
						txCidToRxCid[scid] = rxCid;
						sendResult(rxCid, rxMtu, obj.rxMps, obj.rxCredits, result);
						
						return obj.userObj;
					};
					if (lePsm in cocLePsmRegistry) {
						cocLePsmRegistry[lePsm](txMtu, callback);
					} else {
						callback(L2CAPCoCErrors.LE_PSM_NOT_SUPPORTED);
					}
					return;
				}
				if (code == L2CAP_SIG_LE_FLOW_CONTROL_CREDIT) {
					if (data.length != 4) {
						return;
					}
					var txCid = data.readUInt16LE(0);
					var credits = data.readUInt16LE(2);
					var rxCid = txCidToRxCid[txCid];
					if (!rxCid) {
						// FIXME: should we send reject command with 'Invalid CID' or just ignore this? The spec is not clear...
						return;
					}
					if (credits == 0) {
						// Ignore, per specification
						return;
					}
					var obj = cocMap[rxCid];
					if (!obj.isActive) {
						// Disconnection in progress
						return;
					}
					obj.txCredits += credits;
					if (obj.txCredits > 65535) {
						disconnectCoc(obj);
						return;
					}
					obj.userObj.emit('credits', credits);
					triggerCocSend(obj);
					return;
				}
				if (code == L2CAP_SIG_DISCONNECTION_REQUEST) {
					if (data.length != 4) {
						return;
					}
					var rxCid = data.readUInt16LE(0);
					var txCid = data.readUInt16LE(2);
					var obj = cocMap[rxCid];
					if (!obj || (!obj.isActive && !obj.isWaitingForDisconnectResponse)) {
						// The reject data has the same format, so reuse it
						sendSignalingPacketReject(identifier, 0x0002, data);
						return;
					}
					if (obj.txCid != txCid) {
						// Silently discard, per specification
						return;
					}
					// The response data has the same format, so reuse it
					sendSignalingPacket(code + 1, identifier, data);
					--numCoc;
					delete txCidToRxCid[txCid];
					delete cocMap[rxCid];
					delete cids[rxCid];
					obj.isActive = false;
					var isWaitingForDisconnectResponse = obj.isWaitingForDisconnectResponse;
					obj.isWaitingForDisconnectResponse = false;
					if (!isWaitingForDisconnectResponse) {
						// We have not already emitted the disconnect event, so do it now
						obj.userObj.emit('disconnect');
					}
					return;
				}
			};
			
			l2capSignalingSendRequest = function(code, data, callback, timeoutFunction) {
				var identifier = allocateIdentifier();
				var timeoutClearFn = conn.setTimeout(function() {
					delete activeIdentifiers[identifier];
					if (timeoutFunction && !disconnected) {
						timeoutFunction();
					}
				}, 30000);
				activeIdentifiers[identifier] = {responseCode: code + 1, callback: callback, timeoutClearFn: timeoutClearFn, timeoutFunction: timeoutFunction};
				sendSignalingPacket(code, identifier, data);
			};
			
			function sendSignalingPacketReject(identifier, reason, data) {
				var buf = Buffer.alloc(2 + data.length);
				buf.writeUInt16LE(reason, 0);
				data.copy(buf, 2);
				sendSignalingPacket(L2CAP_SIG_COMMAND_REJECT, identifier, buf);
			}
			
			function sendSignalingPacket(code, identifier, data) {
				var buf = Buffer.alloc(4 + data.length);
				buf[0] = code;
				buf[1] = identifier;
				buf.writeUInt16LE(data.length, 2);
				data.copy(buf, 4);
				adapter.sendData(aclConn.handle, 0x0005, buf);
			}
			
			function L2CAPCoCManager() {
				this.connect = function(lePsm, initiallyPaused, rxMtu, callback) {
					validate(Number.isInteger(lePsm) && lePsm >= 0x0001 && lePsm <= 0x00ff, 'Invalid LE PSM');
					validate(typeof rxMtu === 'undefined' || (Number.isInteger(rxMtu) && rxMtu >= 23 && rxMtu <= 65535), 'Invalid rxMtu');
					callback = fixCallback(this, callback);
					if (conn.disconnected) {
						return;
					}
					if (!rxMtu) {
						rxMtu = 65535;
					}
					if (numCoc == 0xffc0) {
						callback(L2CAPCoCErrors.NO_RESOURCES_AVAILABLE);
						return;
					}
					var rxCid;
					for (rxCid = 0x40; ; ++rxCid) {
						if (!(rxCid in cocMap)) {
							break;
						}
					}
					var obj = {
						rxCid: rxCid,
						txCid: -1,
						txMps: 0,
						rxMps: Math.min(rxMtu, 1004),
						txMtu: 0,
						rxMtu: rxMtu,
						txCredits: 0,
						rxCredits: initiallyPaused ? 0 : 500,
						incomingPackets: new Queue(),
						rxSduBytesLeft: 0,
						isPaused: false,
						isInDataCallback: false,
						outgoingPackets: new Queue(),
						hasPendingOutgoingPacket: false,
						isActive: false,
						isWaitingForDisconnectResponse: false,
						userObj: null
					};
					cocMap[rxCid] = obj;
					++numCoc;
					var buf = Buffer.alloc(10);
					buf.writeUInt16LE(lePsm, 0);
					buf.writeUInt16LE(rxCid, 2);
					buf.writeUInt16LE(rxMtu, 4);
					buf.writeUInt16LE(obj.rxMps, 6);
					buf.writeUInt16LE(obj.rxCredits, 8);
					function fail(reason) {
						--numCoc;
						delete cocMap[rxCid];
						callback(reason);
					}
					l2capSignalingSendRequest(L2CAP_SIG_LE_CREDIT_BASED_CONNECTION_REQUEST, buf, function(responseData) {
						if (responseData.length != 10) {
							fail(L2CAPCoCErrors.TIMEOUT);
							return;
						}
						var result = responseData.readUInt16LE(8);
						if (result != L2CAPCoCErrors.CONNECTION_SUCCESSFUL) {
							fail(result);
							return;
						}
						obj.txCid = responseData.readUInt16LE(0);
						obj.txMtu = responseData.readUInt16LE(2);
						obj.txMps = Math.min(responseData.readUInt16LE(4), 1004); // Even if peer accepts larger MPS, don't use it
						obj.txCredits = responseData.readUInt16LE(6);
						obj.isActive = true;
						obj.userObj = new L2CAPCoC(obj);
						
						callback(result, obj.userObj);
					}, function() {
						fail(L2CAPCoCErrors.TIMEOUT);
					});
				};
				
				this.registerLePsm = function(lePsm, onRequestCallback) {
					validate(Number.isInteger(lePsm) && lePsm >= 0x0001 && lePsm <= 0x00ff, 'lePsm must be in the range 0x0001 - 0x00ff');
					validate(typeof onRequestCallback === 'function', 'onRequestCallback must be a function');
					onRequestCallback = fixCallback(this, onRequestCallback);
					
					cocLePsmRegistry[lePsm] = onRequestCallback;
				};
				
				this.unregisterLePsm = function(lePsm) {
					validate(Number.isInteger(lePsm) && lePsm >= 0x0001 && lePsm <= 0x00ff, 'lePsm must be in the range 0x0001 - 0x00ff');
					
					delete cocLePsmRegistry[lePsm];
				};
			}
			Object.defineProperty(conn, 'l2capCoCManager', {enumerable: true, configurable: false, writable: false, value: new L2CAPCoCManager()});
		})();
		
		
		aclConn.on('disconnect', function(reason) {
			disconnected = true;
			for (var id in timeouts) {
				timeouts[id]();
			}
			timeouts = Object.create(null);
			delete connections[conn.id];
			gattDbOnDisconnected(conn);
			conn.emit('disconnect', reason);
		});
		aclConn.on('connectionUpdate', function(interval, latency, timeout) {
			if (connParamUpdateHook) {
				connParamUpdateHook();
			}
			conn.emit('connectionUpdate', interval, latency, timeout);
		});
		
		cids[0x0005] = l2capSignalingOnData;
		
		aclConn.on('data', function(cid, data) {
			if (!ignoringIncomingData && cid in cids) {
				cids[cid](data);
			}
		});
		
		var gattClientOnSmpPairingDoneFunc;
		
		var smp = role ? new Smp.SmpSlaveConnection(conn, function(cb) {
			cids[0x0006] = cb;
		}, function(data, sentCallback, completeCallback) {
			if (!disconnected) {
				adapter.sendData(aclConn.handle, 0x0006, data, sentCallback, completeCallback);
			}
		}, function(cb) {
			aclConn.on('ltkRequest', function(randomNumber, ediv) {
				cb(randomNumber, ediv, function(ltk, callback) {
					if (disconnectInitiated || disconnected) {
						return;
					}
					if (ltk) {
						adapter.leLongTermKeyRequestReply(aclConn.handle, ltk, function(status, on) {
							// There is really no reason why this could fail unless the link terminates.
							// If master doesn't respond to the LL_START_ENC_REQ then the link will terminate anyway.
							if (status != 0 || !on) {
								return;
							}
							callback();
						});
					} else {
						adapter.leLongTermKeyNequestNegativeReply(aclConn.handle, function(status) {
							callback();
						});
					}
				});
			});
		}, function(t, a) {
			peerIdentityAddressType = t;
			peerIdentityAddress = a;
		}, function() {
			gattDbOnBonded(conn);
			gattClientOnSmpPairingDoneFunc();
		}) : new Smp.SmpMasterConnection(conn, function(cb) {
			cids[0x0006] = cb;
		}, function(data, sentCallback, completeCallback) {
			if (!disconnected) {
				adapter.sendData(aclConn.handle, 0x0006, data, sentCallback, completeCallback);
			}
		}, function(randomNumber, ediv, ltk, callback) {
			if (!disconnected) {
				adapter.leStartEncryption(aclConn.handle, randomNumber, ediv, ltk, function(status) {
					if (status != 0) {
						// It's unexpected that encryption would fail, unless the link disconnects or an encryption procedure is already going on
						callback(status);
					}
				}, callback);
			}
		}, function(t, a) {
			peerIdentityAddressType = t;
			peerIdentityAddress = a;
		}, function() {
			gattDbOnBonded(conn);
			gattClientOnSmpPairingDoneFunc();
		});
		
		Object.defineProperty(conn, 'smp', {enumerable: true, configurable: false, writable: false, value: smp});
		
		var gatt = new GattConnection(conn, attDb, function(cb) {
			cids[0x0004] = cb;
		}, function(data, sentCallback, completeCallback) {
			if (!disconnected) {
				adapter.sendData(aclConn.handle, 0x0004, data, sentCallback, completeCallback);
			}
		}, function(callback) {
			gattClientOnSmpPairingDoneFunc = callback;
		});
		
		Object.defineProperty(conn, 'gatt', {enumerable: true, configurable: false, writable: false, value: gatt});
		
		gattDbOnConnected1(conn);
		
		if (role == 0) {
			pendingConn.pendingConnection.emit('connect', conn);
		}
		if (connectedCallback) {
			connectedCallback(conn);
		}
		
		gattDbOnConnected2(conn);
	}
	
	function triggerConnectionChange() {
		if (connectCommandInProgress || cancelCommandInProgress) {
			return;
		}
		
		function compatibleConnectionParameters() {
			var p = {
				connIntervalMin: null,
				connIntervalMax: null,
				connLatency: null,
				supervisionTimeout: null,
				minimumCELength: null,
				maximumCELength: null
			};
			for (var connId in pendingConnections) {
				if (!pendingConnections.hasOwnProperty(connId)) {
					continue;
				}
				var conn = pendingConnections[connId].parameters;
				if (conn.connIntervalMin != null) {
					if (p.connIntervalMin == null) {
						p.connIntervalMin = conn.connIntervalMin;
						p.connIntervalMax = conn.connIntervalMax;
					} else if (p.connIntervalMax < conn.connIntervalMin || conn.connIntervalMax < p.connIntervalMin) {
						return null;
					} else {
						p.connIntervalMin = Math.max(p.connIntervalMin, conn.connIntervalMin);
						p.connIntervalMax = Math.min(p.connIntervalMax, conn.connIntervalMax);
					}
				}
				if (conn.connLatency != null) {
					if (p.connLatency == null) {
						p.connLatency = conn.connLatency;
					} else if (p.connLatency != conn.connLatency) {
						return null;
					}
				}
				if (conn.supervisionTimeout != null) {
					if (p.supervisionTimeout == null) {
						p.supervisionTimeout = conn.supervisionTimeout;
					} else if (p.supervisionTimeout != conn.supervisionTimeout) {
						return null;
					}
				}
				if (conn.minimumCELength != null) {
					if (p.minimumCELength == null) {
						p.minimumCELength = conn.minimumCELength;
					} else if (p.minimumCELength != conn.minimumCELength) {
						return null;
					}
				}
				if (conn.maximumCELength != null) {
					if (p.maximumCELength == null) {
						p.maximumCELength = conn.maximumCELength;
					} else if (p.maximumCELength != conn.maximumCELength) {
						return null;
					}
				}
			}
			return p;
		}
		
		var pendingConnectionsArr = Object.keys(pendingConnections).map(k => pendingConnections[k]);
		
		var useWhiteList = 2 <= pendingConnectionsArr.length && pendingConnectionsArr.length <= whiteListSize;
		var connParams = compatibleConnectionParameters();
		var mustUseScan = pendingConnectionsArr.length > whiteListSize || connParams == null; // TODO: or if scanning and can't scan and connect concurrently
		var scanParameters = calcScanParameters(pendingConnectionsArr.filter(c => c.parameters.scanWindow != null && c.parameters.scanInterval != null).map(c => c.parameters));
		
		if (mustUseScan && pendingConnectionsArr.length != 0) {
			var scanFilters = pendingConnectionsArr.map(c => new BdAddrScanFilter(c.bdAddrType, c.bdAddr));
			var newScanner = this.startScan(false, scanParameters, scanFilters, true, err => {
				// TODO
			});
			if (pendingConnectScanner != null) {
				pendingConnectScanner.stopScan();
			}
			pendingConnectScanner = newScanner;
			pendingConnectScanner.on('report', report => {
				pendingConnectScanner.stopScan();
				pendingConnectScanner = null;
				
				var conn = pendingConnectionsArr.find(c => c.bdAddrType == report.addressType && c.bdAddr == report.address);
				conn.connecting = true;
				
				connectCommandInProgress = true;
				stopScanCallback = () => {
					
					connectingExplicitly = true;
					// Now scanner is idle and blocked until connectingExplicitly is set to false
					
					var timeoutClearFn = function() {};
					
					connParams = makeConnParamsValid(conn);
					adapter.leCreateConnection(48, 48, 0x00, conn.bdAddrType == "public" ? 0x00 : 0x01, connParams.bdAddr, ownAddressType == 'public' ? 0x00 : 0x01, connParams.connIntervalMin, connParams.connIntervalMax, connParams.connLatency, connParams.supervisionTimeout, connParams.minimumCELength, connParams.maximumCELength, status => {
						connectCommandInProgress = false;
						
						if (conn.cancelled) {
							if (status == 0) {
								createConnectionIsOutstanding = true;
								cancelCommandInProgress = true;
								adapter.leCreateConnectionCancel(status => {
								});
							} else {
								// Probably max connections reached, possibly failed because controller can't put it into initiating state at this time
								delete pendingConnections[conn.id];
								connectingExplicitly = false;
								triggerScannerChange();
								triggerConnectionChange();
								if (conn.cancelledCallback) {
									conn.cancelledCallback();
								}
							}
							return;
						}
						
						if (status == 0) {
							createConnectionIsOutstanding = true;
							timeoutClearFn = manager.setTimeout(() => {
								cancelCommandInProgress = true;
								adapter.leCreateConnectionCancel(status => {
									// If we cancelled in time, the connection complete event will be sent with HCI_NO_CONNECTION, otherwise the connection completed as we really wanted
								});
							}, 20000);
						} else {
							// Probably max connections reached, possibly failed because controller can't put it into initiating state at this time
							conn.connecting = false;
							connectingExplicitly = false;
							triggerScannerChange();
						}
						triggerConnectionChange();
					}, (status, aclConn, role, peerAddressType, peerAddress, connInterval, connLatency, supervisionTimeout, masterClockAccuracy) => {
						cancelCommandInProgress = false;
						conn.connecting = false;
						createConnectionIsOutstanding = false;
						connectingExplicitly = false;
						timeoutClearFn();
						if (status == 0) {
							// Connection now complete
							delete pendingConnections[conn.id];
							conn.connected = true;
							triggerScannerChange();
							triggerConnectionChange();
							onConnected(role, aclConn, conn, null, peerAddressType == 0x00 ? 'public' : 'random', peerAddress, connInterval, connLatency, supervisionTimeout, masterClockAccuracy);
							return;
						}
						if (conn.cancelled) {
							delete pendingConnections[conn.id];
							triggerScannerChange();
							triggerConnectionChange();
							if (conn.cancelledCallback) {
								conn.cancelledCallback();
							}
							return;
						}
						
						if (status == Errors.HCI_NO_CONNECTION) {
							// Connection attempt was cancelled
						} else {
							// This can't happen if the controller isn't too buggy as far as I know
						}
						triggerScannerChange();
						triggerConnectionChange();
					});
				};
				triggerScannerChange();
			});
			return;
		}
		
		if (pendingConnectScanner != null) {
			pendingConnectScanner.stopScan();
			pendingConnectScanner = null;
		}
		
		if (stopScanCallback != null) {
			return;
		}
		
		var targetDevices = pendingConnectionsArr.map(c => (c.bdAddrType == "public" ? "00:" : "01:") + c.bdAddr);
		sortWhiteListAndRemoveDuplicates(targetDevices);
		//console.log('target devices: ', targetDevices);
		
		if (currentConnectingAddresses != null) {
			if (arraysAreEqual(currentConnectingAddresses, targetDevices)) {
				// Everything is already in the correct state
				//console.log('fine');
			} else {
				// We must abort connection attempt and restart
				//console.log('cancelling');
				cancelCommandInProgress = true;
				adapter.leCreateConnectionCancel(status => {
				});
			}
			return;
		}
		
		if (pendingConnectionsArr.length == 0) {
			return;
		}
		
		pendingConnectionsArr.forEach(conn => {
			conn.connecting = true;
		});
		connectCommandInProgress = true;
		
		if (useWhiteList && whiteListUsage == WHITE_LIST_USAGE_SCANNER) {
			stopScanCallback = cont;
		} else {
			cont();
		}
		function cont() {
			if (useWhiteList) {
				whiteListUsage = WHITE_LIST_USAGE_INITIATOR;
				
				updateWhiteList(targetDevices, function(err) {
					// TODO: if (err), maybe just set whiteListSize to 0 and restart
					cont2();
				});
			} else {
				cont2();
			}
			
			function cont2() {
				connParams = makeConnParamsValid(connParams);
				//console.log('sending create connection');
				adapter.leCreateConnection(scanParameters.scanInterval, scanParameters.scanWindow,
					useWhiteList ? 0x01 : 0x00,
					useWhiteList ? 0x00 : parseInt(targetDevices[0]),
					useWhiteList ? "00:00:00:00:00:00" : targetDevices[0].substr(3),
					ownAddressType == 'public' ? 0x00 : 0x01,
					connParams.connIntervalMin, connParams.connIntervalMax, connParams.connLatency, connParams.supervisionTimeout, connParams.minimumCELength, connParams.maximumCELength, status => {
					//console.log('status: ', status);
					
					connectCommandInProgress = false;
					var cancelledConns = pendingConnectionsArr.filter(c => c.cancelled);
					if (status == 0) {
						createConnectionIsOutstanding = true;
						currentConnectingAddresses = targetDevices;
						if (cancelledConns.length != 0) {
							cancelCommandInProgress = true;
							adapter.leCreateConnectionCancel(status => {
							});
						} else {
							triggerConnectionChange();
						}
					} else {
						// TODO: Probably max connections reached, possibly failed because controller can't put it into initiating state at this time
						whiteListUsage = null;
						cancelledConns.forEach(conn => {
							delete pendingConnections[conn.id];
						});
						pendingConnectionsArr.forEach(conn => {
							conn.connecting = false;
						});
						triggerConnectionChange();
						cancelledConns.forEach(conn => {
							if (conn.cancelledCallback) {
								conn.cancelledCallback();
							}
						});
					}
				}, (status, aclConn, role, peerAddressType, peerAddress, connInterval, connLatency, supervisionTimeout, masterClockAccuracy) => {
					//console.log('connection complete: ', status);
					
					whiteListUsage = null;
					cancelCommandInProgress = false;
					createConnectionIsOutstanding = false;
					currentConnectingAddresses = null;
					pendingConnectionsArr.forEach(conn => {
						conn.connecting = false;
					});
					var conn = status == 0 && pendingConnectionsArr.find(c => c.bdAddrType == (peerAddressType == 0x00 ? "public" : "random") && c.bdAddr == peerAddress);
					var cancelledConns = pendingConnectionsArr.filter(c => c.cancelled && (!conn || c.id != conn.id));
					
					cancelledConns.forEach(conn => {
						delete pendingConnections[conn.id];
					});
					
					if (status == 0) {
						if (!conn) {
							//console.log('connection complete but failed conn', pendingConnectionsArr, peerAddressType, peerAddress);
							throw new Error("connection complete but failed conn");
						}
						// Connection now complete
						delete pendingConnections[conn.id];
						conn.connected = true;
						triggerConnectionChange();
						
						onConnected(role, aclConn, conn, null, peerAddressType == 0x00 ? 'public' : 'random', peerAddress, connInterval, connLatency, supervisionTimeout, masterClockAccuracy);
					} else {
						triggerConnectionChange();
					}
					cancelledConns.forEach(conn => {
						if (conn.cancelledCallback) {
							conn.cancelledCallback();
						}
					});
				});
			}
		}
	}
	
	this.startScan = function(parameters) {
		parameters = parameters || Object.create(null);
		validate(typeof parameters === 'object', 'Invalid parameters - must be an object');
		var activeScan = parameters.activeScan;
		var scanWindow = parameters.scanWindow;
		var scanInterval = parameters.scanInterval;
		var scanFilters = parameters.scanFilters;
		var filterDuplicates = parameters.filterDuplicates;
		var errorCallback = parameters.errorCallback;
		
		if (typeof activeScan === 'undefined') {
			activeScan = true;
		}
		if (typeof filterDuplicates === 'undefined') {
			filterDuplicates = false;
		}
		
		validate(typeof activeScan === 'boolean', "Invalid activeScan");
		validate(typeof scanInterval === 'undefined' || (Number.isInteger(scanInterval) && scanInterval >= 4 && scanInterval <= 0x4000), 'Invalid scanInterval');
		validate(typeof scanWindow === 'undefined' || (Number.isInteger(scanWindow) && scanWindow >= 4 && scanWindow <= 0x4000), 'Invalid scanWindow');
		validate(typeof scanWindow === 'undefined' || scanWindow <= scanInterval, 'scanWindow must be less than or equal to scanInterval');
		validate(!scanFilters || Array.isArray(scanFilters), 'Invalid scanFilters');
		validate(typeof filterDuplicates === 'boolean', 'Invalid filterDuplicates');
		errorCallback = fixCallback(this, errorCallback);
		
		if (scanFilters && scanFilters.length == 0) {
			scanFilters = null;
		}
		
		var scanner = {
			id: idGenerator.next(),
			scanner: new Scanner(),
			activeScan: activeScan,
			scanParameters: scanWindow && {scanWindow: scanWindow, scanInterval: scanInterval},
			scanFilters: scanFilters && scanFilters.map(f => f),
			filterDuplicates: filterDuplicates,
			duplicateCache: filterDuplicates ? new DuplicateCache(1024) : null,
			advDataCache: new DuplicateCache(1024),
			errorCallback: errorCallback,
			stopped: false
		};
		scanners[scanner.id] = scanner;
		
		scanner.scanner.stopScan = function() {
			if (!scanner.stopped) {
				scanner.stopped = true;
				delete scanners[scanner.id];
				triggerScannerChange();
			}
		};
		
		if (currentScanFilterDuplicates) {
			scanningNeedsRestart = true;
		}
		triggerScannerChange();
		return scanner.scanner;
	};
	
	this.connect = function(bdAddrType, bdAddr, parameters, callback) {
		var hasCallback = !!callback;
		validate(bdAddrType === "public" || bdAddrType === "random", "Invalid bdAddrType");
		validate(isValidBdAddr(bdAddr), "Invalid bdAddr");
		callback = fixCallback(this, callback);
		validate(!Object.keys(pendingConnections).map(c => pendingConnections[c]).concat(Object.keys(connections).map(c => connections[c])).some(c => c.peerAddressType == bdAddrType && c.peerAddress == bdAddr.toUpperCase()), "Already has a connection to this device");
		
		parameters = validateConnectionParameters(parameters);
		
		var pc = new PendingConnection();
		if (hasCallback) {
			pc.on('connect', callback);
		}
		
		var connection = {
			id: idGenerator.next(),
			bdAddrType: bdAddrType,
			bdAddr: bdAddr.toUpperCase(),
			parameters: parameters,
			pendingConnection: pc,
			connecting: false,
			connected: false,
			cancelled: false,
			cancelledCallback: null
		};
		pendingConnections[connection.id] = connection;
		triggerConnectionChange();
		
		pc.cancel = function(callback) {
			callback = fixCallback(pc, callback);
			if (connection.connected) {
				return;
			}
			if (!connection.cancelled) {
				connection.cancelled = true;
				if (connection.connecting) {
					connection.cancelledCallback = callback;
					if (createConnectionIsOutstanding && !cancelCommandInProgress) {
						cancelCommandInProgress = true;
						adapter.leCreateConnectionCancel(status => {
						});
					}
				} else {
					delete pendingConnections[connection.id];
					triggerConnectionChange();
					callback();
				}
			}
		};
		return pc;
	};
	
	this.startAdvertising = function(parameters, callback) {
		callback = fixCallback(this, callback);
		
		parameters = parameters || {};
		
		var intervalMin = parameters.intervalMin;
		var intervalMax = parameters.intervalMax;
		var advertisingType = parameters.advertisingType;
		var directedAddress = parameters.directedAddress;
		var channelMap = parameters.channelMap;
		
		var directedAddressType, directedAddressAddress;
		
		// ADV_DIRECT_IND_LOW_DUTY_CYCLE only available on Bluetooth 4.1
		var advTypes = {'ADV_IND': 0, 'ADV_DIRECT_IND_HIGH_DUTY_CYCLE': 1, 'ADV_SCAN_IND': 2, 'ADV_NONCONN_IND': 3, 'ADV_DIRECT_IND_LOW_DUTY_CYCLE': 4};
		
		validate(!intervalMin || (Number.isInteger(intervalMin) && intervalMin >= 0x20 && intervalMin <= 0x4000), 'Invalid intervalMin. Must be an integer between 0x20 and 0x4000 in units of 0.625ms.');
		validate(!intervalMax || (Number.isInteger(intervalMax) && intervalMax >= 0x20 && intervalMax <= 0x4000), 'Invalid intervalMax. Must be an integer between 0x20 and 0x4000 in units of 0.625ms.');
		validate(!intervalMin == !intervalMax, 'Either none or both of intervalMin and intervalMax must be supplied');
		validate(!intervalMin || intervalMin <= intervalMax, 'intervalMin must be less or equal to intervalMax');
		validate(!advertisingType || (typeof advertisingType === 'string' && advertisingType in advTypes), 'Invalid advertisingType. Must be one of the strings ADV_IND, ADV_DIRECT_IND_HIGH_DUTY_CYCLE, ADV_SCAN_IND, ADV_NONCONN_IND and ADV_DIRECT_IND_LOW_DUTY_CYCLE');
		if (directedAddress) {
			validate(typeof directedAddress === 'object' && directedAddress !== null, 'directedAddress must be an object containing the keys type and address');
			directedAddressType = directedAddress.type;
			directedAddressAddress = directedAddress.address;
			validate(directedAddressType === 'public' || directedAddressType === 'random', 'directedAddress.type must be either the string random or public');
			validate(isValidBdAddr(directedAddressAddress), 'Invalid directedAddress.address');
		}
		validate(!!directedAddress == (advertisingType == 'ADV_DIRECT_IND_HIGH_DUTY_CYCLE' || advertisingType == 'ADV_DIRECT_IND_LOW_DUTY_CYCLE'), 'When directed advertising is used, both a directed address must be supplied as well as a directed advertising type');
		validate(!channelMap || Array.isArray(channelMap), 'channelMap must be an array containing some of the channels 37, 38 and 39');
		var channelMapBitmap = 0;
		if (channelMap) {
			for (var i = 37; i <= 39; i++) {
				for (var j = 0; j < channelMap.length; j++) {
					if (channelMap[j] == i) {
						channelMapBitmap |= 1 << (i - 37);
					}
				}
			}
			validate(channelMapBitmap != 0, 'channelMap must be an array containing some of the channels 37, 38 and 39');
		} else {
			channelMapBitmap = 7;
		}
		
		validate(!isAdvertisingUserSet, 'Advertising already running, please stop first before you can start again');
		
		isAdvertisingUserSet = true;
		startAdvQueueSize++;
		
		// function(advertisingIntervalMin, advertisingIntervalMax, advertisingType, ownAddressType, peerAddressType,
		// peerAddress, advertisingChannelMap, advertisingFilterPolicy, callback)
		adapter.leSetAdvertisingParameters(intervalMin || 100, intervalMax || 120, advTypes[advertisingType || 'ADV_IND'], ownAddressType == 'public' ? 0x00 : 0x01, directedAddressType == 'random' ? 1 : 0, directedAddressAddress || "00:00:00:00:00:00", channelMapBitmap, 0, function(status) {
			if (status != 0) {
				if (--startAdvQueueSize == 0) {
					isAdvertisingUserSet = false;
				}
				callback(status);
				return;
			}
			adapter.leSetAdvertisingEnable(true, function(status) {
				startAdvQueueSize--;
				if (status != 0) {
					if (startAdvQueueSize == 0) {
						isAdvertisingUserSet = false;
					}
					callback(status);
					return;
				}
				isAdvertisingAccordingToStatus = true;
			}, function(status, aclConn, role, peerAddressType, peerAddress, connInterval, connLatency, supervisionTimeout, masterClockAccuracy) {
				isAdvertisingAccordingToStatus = false;
				if (startAdvQueueSize == 0) {
					isAdvertisingUserSet = false;
				}
				if (status != 0) {
					// Directed timeout
					callback(status);
					return;
				}
				onConnected(role, aclConn, null, function(conn) {
					callback(status, conn);
				}, peerAddressType == 0x00 ? 'public' : 'random', peerAddress, connInterval, connLatency, supervisionTimeout, masterClockAccuracy);
			});
		});
	};
	
	this.stopAdvertising = function(callback) {
		validate(isAdvertisingUserSet, 'Advertising not running');
		isAdvertisingUserSet = false;
		callback = fixCallback(this, callback);
		adapter.leSetAdvertisingEnable(false, function(status) {
			isAdvertisingAccordingToStatus = false;
			callback(status);
		});
	};
	
	this.setAdvertisingData = function(data, callback) {
		validate(data instanceof Buffer && data.length <= 31, 'data must be a Buffer of max length 31');
		callback = fixCallback(this, callback);
		adapter.leSetAdvertisingData(data, callback);
	};
	
	this.setScanResponseData = function(data, callback) {
		validate(data instanceof Buffer && data.length <= 31, 'data must be a Buffer of max length 31');
		callback = fixCallback(this, callback);
		adapter.leSetScanResponseData(data, callback);
	};
	
	this.readAdvertisingChannelTxPower = function(callback) {
		callback = fixCallback(this, callback);
		adapter.leReadAdvertisingChannelTxPower(callback);
	};
	
	this.removeBond = function(identityAddressType, identityAddress) {
		validate(identityAddressType == 'public' || identityAddressType == 'random', 'Invalid address type');
		validate(isValidBdAddr(identityAddress), 'Invalid address');
		identityAddress = identityAddress.toUpperCase();
		
		for (var id in connections) {
			validate(!(connections[id].peerIdentityAddressType == identityAddressType && connections[id].peerIdentityAddress == identityAddress), 'Please disconnect first before removing bond');
		}
		
		var ownAddressLong = storage.constructAddress(ownAddressType, controllerBdAddr);
		var identityAddressLong = storage.constructAddress(identityAddressType, identityAddress);
		
		storage.removeBond(ownAddressLong, identityAddressLong);
	};
	
	Object.defineProperty(this, 'gattDb', {
		value: gattDb,
		enumerable: true,
		configurable: false,
		writable: false
	});
}
util.inherits(BleManager, EventEmitter);

module.exports = Object.freeze({
	create: function(transport, options, initCallback) {
		options = options || Object.create(null);
		validate(typeof initCallback === 'function', 'Invalid callback');
		validate(typeof transport === 'object' && transport !== null, 'Invalid transport');
		validate(typeof transport.on === 'function' && typeof transport.write === 'function', 'Invalid transport object');
		
		var staticRandomAddress = options.staticRandomAddress;
		if (staticRandomAddress) {
			validate(isValidBdAddr(staticRandomAddress) && /^[c-fC-F]/.test(staticRandomAddress), 'Invalid static random address, must start with C, D, E or F');
			staticRandomAddress = staticRandomAddress.toUpperCase();
		}
		
		new BleManager(transport, staticRandomAddress || null, function(error, manager) {
			initCallback.call(null, error, manager);
		});
	},
	BdAddrScanFilter: BdAddrScanFilter,
	ServiceUUIDScanFilter: ServiceUUIDScanFilter
});
