const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const utils = require('./utils');
const DuplicateCache = utils.DuplicateCache;

const emptyBuffer = Buffer.alloc(0);

const basePath = "NodeBleLib-storage-dir";

var cache = Object.create(null);

function bufferToHex(b) {
	return !b ? null : b.toString('hex');
}

function fixAddressToPath(a) {
	return a.replace(/:/g, '-');
}

function fixAddressFromPath(a) {
	return a.replace(/-/g, ':');
}

function timingSafeEqual(a, b) {
	return crypto.timingSafeEqual ? crypto.timingSafeEqual(a, b) : a.equals(b);
}

function mkdirRecursive(pathItems) {
	for (var i = 1; i <= pathItems.length; i++) {
		try {
			var p = path.join.apply(null, pathItems.slice(0, i));
			fs.mkdirSync(p);
		} catch (e) {
			if (e.code == 'EEXIST') {
				continue;
			}
			//console.log('mkdirRecursive', pathItems, e);
			return false;
		}
	}
	return true;
}

function writeFile(pathItems, data) {
	if (!mkdirRecursive(pathItems.slice(0, -1))) {
		return false;
	}
	try {
		fs.writeFileSync(path.join.apply(null, pathItems), data);
	} catch (e) {
		//console.log('writeFileSync', pathItems, data, e);
		return false;
	}
	return true;
}

function constructAddress(type, address) {
	return (type == 'public' ? '00:' : '01:') + address;
}

function storeKeys(ownAddress, peerAddress, mitm, sc, irk, localLtk, localRand, localEdiv, peerLtk, peerRand, peerEdiv) {
	ownAddress = fixAddressToPath(ownAddress);
	peerAddress = fixAddressToPath(peerAddress);
	
	if (!(ownAddress in cache)) {
		init(ownAddress);
	}
	
	var cacheEntry = cache[ownAddress];
	
	if (irk) {
		var irkRev = Buffer.from(irk);
		irkRev.reverse();
		cacheEntry.irks[peerAddress] = {aes: crypto.createCipheriv('AES-128-ECB', irkRev, emptyBuffer), irk: irk};
	}
	
	cacheEntry.ltks[peerAddress] = {
		mitm: mitm,
		sc: sc,
		localLtk: !localLtk ? null : {
			rand: localRand,
			ediv: localEdiv,
			ltk: localLtk
		},
		peerLtk: !peerLtk ? null : {
			rand: peerRand,
			ediv: peerEdiv,
			ltk: peerLtk
		}
	};
	
	// keys.json: {"mitm":(boolean),"sc":(boolean),"irk":(hex),"localLtk":{"ediv":(integer),"rand":(hex),"ltk":(hex)},"peerLtk":{"ediv":(integer),"rand":(hex),"ltk":(hex)}}
	var json = JSON.stringify({
		mitm: mitm,
		sc: sc,
		irk: bufferToHex(irk),
		localLtk: !localLtk ? null : {
			rand: localRand.toString('hex'),
			ediv: localEdiv,
			ltk: localLtk.toString('hex')
		},
		peerLtk: !peerLtk ? null : {
			rand: peerRand.toString('hex'),
			ediv: peerEdiv,
			ltk: peerLtk.toString('hex'),
		}
	});
	
	if (!writeFile([basePath, ownAddress, 'bonds', peerAddress, 'keys.json'], json)) {
		// TODO
	}
}

function resolveAddress(ownAddress, peerRandomAddress) {
	// input format is tt:aa:aa:aa:bb:bb:bb, where tt is 00 for public and 01 for random, rest is MSB -> LSB
	// returns identity address (or address used during pairing if BD_ADDR field was zero in Identity Address Informamtion) in same format or null
	
	ownAddress = fixAddressToPath(ownAddress);
	peerRandomAddress = peerRandomAddress.replace(/:/g, '');
	
	var prand = Buffer.alloc(16);
	Buffer.from(peerRandomAddress.substr(2, 6), 'hex').copy(prand, 13);
	var hash = Buffer.from(peerRandomAddress.substr(8), 'hex');
	
	//console.log('Resolving address', ownAddress, peerRandomAddress, prand, hash);
	
	if (!(ownAddress in cache)) {
		init(ownAddress);
	}
	var irks = cache[ownAddress].irks;
	for (var candidatePeerAddress in irks) {
		//console.log('Testing ', candidatePeerAddress);
		if (timingSafeEqual(irks[candidatePeerAddress].aes.update(prand).slice(13), hash)) {
			//console.log('yes!');
			return fixAddressFromPath(candidatePeerAddress);
		}
	}
	return null;
}

function getKeys(ownAddress, peerAddress) {
	ownAddress = fixAddressToPath(ownAddress);
	peerAddress = fixAddressToPath(peerAddress);
	
	if (!(ownAddress in cache)) {
		init(ownAddress);
	}
	
	var keys = cache[ownAddress].ltks[peerAddress];
	return keys;
}

function storeCccd(ownAddress, peerAddress, handle, value) {
	ownAddress = fixAddressToPath(ownAddress);
	peerAddress = fixAddressToPath(peerAddress);
	
	if (!(ownAddress in cache)) {
		init(ownAddress);
	}
	
	var cacheEntry = cache[ownAddress];
	if (!cacheEntry.cccdValues[peerAddress]) {
		cacheEntry.cccdValues[peerAddress] = Object.create(null);
	}
	if (cacheEntry.cccdValues[peerAddress][handle] != value) {
		cacheEntry.cccdValues[peerAddress][handle] = value;
		writeFile([basePath, ownAddress, 'bonds', peerAddress, 'gatt_server_cccds', ("000" + handle.toString(16)).substr(-4) + '.json'], JSON.stringify(value));
	}
}

function getCccd(ownAddress, peerAddress, handle) {
	ownAddress = fixAddressToPath(ownAddress);
	peerAddress = fixAddressToPath(peerAddress);
	
	if (!(ownAddress in cache)) {
		init(ownAddress);
	}
	
	var cacheEntry = cache[ownAddress];
	
	if (cacheEntry.cccdValues[peerAddress]) {
		return cacheEntry.cccdValues[peerAddress][handle];
	}
	
	return 0;
}

function storeGattCache(ownAddress, peerAddress, isBonded, obj) {
	ownAddress = fixAddressToPath(ownAddress);
	peerAddress = fixAddressToPath(peerAddress);
	
	if (!(ownAddress in cache)) {
		init(ownAddress);
	}
	
	obj.timestamp = Date.now();
	
	var cacheEntry = cache[ownAddress];
	if (isBonded) {
		cacheEntry.bondedPeerGattDbs[peerAddress] = obj;
	} else {
		cacheEntry.unbondedPeerGattDbs.add(peerAddress, obj);
	}
	
	writeFile([basePath, ownAddress, isBonded ? 'bonds' : 'unbonded', peerAddress, 'gatt_client_cache.json'], JSON.stringify(obj));
}

function getGattCache(ownAddress, peerAddress, isBonded) {
	ownAddress = fixAddressToPath(ownAddress);
	peerAddress = fixAddressToPath(peerAddress);
	
	if (!(ownAddress in cache)) {
		init(ownAddress);
	}
	
	var cacheEntry = cache[ownAddress];
	
	if (isBonded) {
		return cacheEntry.bondedPeerGattDbs[peerAddress] || null;
	} else {
		return cacheEntry.unbondedPeerGattDbs.get(peerAddress);
	}
}

function removeBond(ownAddress, peerAddress) {
	ownAddress = fixAddressToPath(ownAddress);
	peerAddress = fixAddressToPath(peerAddress);
	
	if (!(ownAddress in cache)) {
		init(ownAddress);
	}
	
	var cacheEntry = cache[ownAddress];
	
	var remove = false;
	
	if (peerAddress in cacheEntry.irks) {
		remove = true;
		delete cacheEntry.irks[peerAddress];
	}
	
	if (peerAddress in cacheEntry.ltks) {
		remove = true;
		delete cacheEntry.ltks[peerAddress];
	}
	
	if (peerAddress in cacheEntry.cccdValues) {
		remove = true;
		delete cacheEntry.cccdValues[peerAddress];
	}
	
	if (remove) {
		var bondPath = path.join(basePath, ownAddress, 'bonds', peerAddress);
		function recurseRemove(dirPath) {
			fs.readdirSync(dirPath).forEach(p => {
				entryPath = path.join(dirPath, p);
				if (fs.lstatSync(entryPath).isDirectory()) {
					recurseRemove(entryPath);
				} else {
					fs.unlinkSync(entryPath);
				}
			});
			fs.rmdirSync(dirPath);
		}
		try {
			recurseRemove(bondPath);
		} catch (e) {
		}
	}
}

function init(ownAddress) {
	ownAddress = fixAddressToPath(ownAddress);
	
	if (!(ownAddress in cache)) {
		var cacheEntry = {
			irks: Object.create(null),
			ltks: Object.create(null),
			cccdValues: Object.create(null),
			bondedPeerGattDbs: Object.create(null),
			unbondedPeerGattDbs: new DuplicateCache(50)
		};
		cache[ownAddress] = cacheEntry;
		
		try {
			var dir = path.join(basePath, ownAddress, 'bonds');
			fs.readdirSync(dir).forEach(peerAddress => {
				try {
					// TODO: validate that all buffers are of correct size, ediv is a 16-bit integer etc.
					
					var keys = JSON.parse(fs.readFileSync(path.join(dir, peerAddress, 'keys.json')));
					if (keys.irk) {
						var irkBuffer = Buffer.from(keys.irk, 'hex');
						var irkBufferRev = irkBuffer;
						irkBufferRev.reverse();
						var aes = crypto.createCipheriv('AES-128-ECB', irkBufferRev, emptyBuffer);
						cacheEntry.irks[peerAddress] = {aes: aes, irk: irkBuffer};
					}
					if (keys.localLtk || keys.peerLtk) {
						var obj = {mitm: keys.mitm, sc: keys.sc, localLtk: null, peerLtk: null};
						if (keys.localLtk) {
							obj.localLtk = {rand: Buffer.from(keys.localLtk.rand, 'hex'), ediv: keys.localLtk.ediv, ltk: Buffer.from(keys.localLtk.ltk, 'hex')};
						}
						if (keys.peerLtk) {
							obj.peerLtk = {rand: Buffer.from(keys.peerLtk.rand, 'hex'), ediv: keys.peerLtk.ediv, ltk: Buffer.from(keys.peerLtk.ltk, 'hex')};
						}
						cacheEntry.ltks[peerAddress] = obj;
					}
				} catch(e) {
					//console.log('readFileSync', e);
				}
				
				try {
					var obj = JSON.parse(fs.readFileSync(path.join(dir, peerAddress, 'gatt_client_cache.json')));
					cacheEntry.bondedPeerGattDbs[peerAddress] = obj;
				} catch(e) {
					//console.log('readFileSync 2', e);
				}
				
				try {
					fs.readdirSync(path.join(dir, peerAddress, 'gatt_server_cccds')).forEach(handleFileName => {
						if (/^[a-zA-Z0-9]{4}\.json$/.test(handleFileName)) {
							try {
								var v = JSON.parse(fs.readFileSync(path.join(dir, peerAddress, 'gatt_server_cccds', handleFileName)));
								if (v === 0 || v === 1 || v === 2 || v === 3) {
									if (!cacheEntry.cccdValues[peerAddress]) {
										cacheEntry.cccdValues[peerAddress] = Object.create(null);
									}
									cacheEntry.cccdValues[peerAddress][parseInt(handleFileName, 16)] = v;
								}
							} catch(e) {
								//console.log('readFileSync', e);
							}
						}
					});
				} catch(e) {
					//console.log('readdir', e);
				}
			});
			
		} catch(e) {
			//console.log('readdir', e);
		}
		
		cacheEntry.unbondedPeerGattDbs.on('remove', peerAddress => {
			try {
				fs.unlinkSync(path.join(basePath, ownAddress, 'unbonded', peerAddress, 'gatt_client_cache.json'));
			} catch(e) {
			}
		});
		
		try {
			var unbondedGattCaches = [];
			var dir = path.join(basePath, ownAddress, 'unbonded');
			fs.readdirSync(dir).forEach(peerAddress => {
				try {
					var obj = JSON.parse(fs.readFileSync(path.join(dir, peerAddress, 'gatt_client_cache.json')));
					unbondedGattCaches.push({peerAddress: peerAddress, obj: obj});
				} catch(e) {
				}
			});
			unbondedGattCaches.sort((a, b) => a.obj.timestamp - b.obj.timestamp);
			unbondedGattCaches.forEach(item => {
				cacheEntry.unbondedPeerGattDbs.add(item.peerAddress, item.obj);
			});
		} catch(e) {
		}
		
		//console.log(cacheEntry);
	}
}

module.exports = Object.freeze({
	constructAddress: constructAddress,
	storeKeys: storeKeys,
	getKeys: getKeys,
	resolveAddress: resolveAddress,
	storeCccd: storeCccd,
	getCccd: getCccd,
	storeGattCache: storeGattCache,
	getGattCache: getGattCache,
	removeBond: removeBond
});
