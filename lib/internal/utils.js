const EventEmitter = require('events');
const util = require('util');

const BASE_UUID_SECOND_PART = '-0000-1000-8000-00805F9B34FB';

function Queue() {
	var q = [];
	var pos = 0;
	
	this.getLength = function() {
		return q.length - pos;
	};
	
	this.push = function(v) {
		q.push(v);
	};
	
	this.shift = function() {
		if (pos == q.length) {
			return undefined;
		}
		var elem = q[pos++];
		if (pos * 2 >= q.length) {
			q.splice(0, pos);
			pos = 0;
		}
		return elem;
	};
	
	this.peek = function() {
		if (pos == q.length) {
			return undefined;
		}
		return q[pos];
	};
	
	this.getAt = function(i) {
		if (pos + i >= q.length) {
			return undefined;
		}
		return q[pos + i];
	};
}

function IdGenerator() {
	var last = "";
	this.next = function() {
		for (var pos = last.length - 1; pos >= 0; --pos) {
			if (last[pos] != 'z') {
				return last = last.substr(0, pos) + String.fromCharCode(last.charCodeAt(pos) + 1) + 'a'.repeat(last.length - pos - 1);
			}
		}
		return last = 'a'.repeat(last.length + 1);
	};
}

function DuplicateCache(capacity) {
	if (capacity <= 0) {
		throw new Error("Invalid capacity");
	}
	EventEmitter.call(this);
	
	var first = null;
	var last = null;
	var nodeMap = Object.create(null);
	
	var dc = this;
	
	this.isDuplicate = function(key) {
		return key in nodeMap;
	};
	
	this.get = function(key) {
		if (key in nodeMap) {
			return nodeMap[key].value;
		} else {
			return null;
		}
	};
	
	this.remove = function(key) {
		if (key in nodeMap) {
			var node = nodeMap[key];
			delete nodeMap[key];
			if (node.next != null) {
				node.next.prev = node.prev;
			}
			if (first == node) {
				first = node.next;
			}
			if (last == node) {
				last = node.prev;
			}
			++capacity;
			return true;
		}
		return false;
	};
	
	// Adds or updates the value. Returns false if the key already was in the cache (but updates regardless).
	this.add = function(key, value) {
		var exists = dc.remove(key);
		var firstKey, removedFirstKey = false;
		if (capacity == 0) {
			firstKey = first.key;
			removedFirstKey = true;
			delete nodeMap[first.key];
			first = first.next;
			if (first) {
				first.prev = null;
			} else {
				last = null;
			}
			++capacity;
		}
		var node = {prev: last, next: null, key: key, value: value};
		nodeMap[key] = node;
		last = node;
		if (first == null) {
			first = node;
		}
		--capacity;
		if (removedFirstKey && firstKey != key) {
			dc.emit('remove', firstKey);
		}
		return !exists;
	};
}
util.inherits(DuplicateCache, EventEmitter);

function serializeUuid(v) {
	if (typeof v === 'string') {
		if (v.substr(8) == BASE_UUID_SECOND_PART && v.substr(0, 4) == '0000') {
			return Buffer.from(v.substr(4, 4), 'hex').reverse();
		}
		var ret = Buffer.from(v.replace(/-/g, ''), 'hex').reverse();
		if (ret.length == 16) {
			return ret;
		}
	} else if (Number.isInteger(v) && v >= 0 && v <= 0xffff) {
		return Buffer.from([v, v >> 8]);
	}
	throw new Error('Invalid uuid: ' + v);
}

function isValidBdAddr(bdAddr) {
	return typeof bdAddr === 'string' && /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(bdAddr);
}

function bdAddrToBuffer(address) {
	var buf = [];
	for (var i = 15; i >= 0; i -= 3) {
		buf.push(parseInt(address.substr(i, 2), 16));
	}
	return Buffer.from(buf);
}

module.exports = Object.freeze({
	Queue: Queue,
	IdGenerator: IdGenerator,
	DuplicateCache: DuplicateCache,
	serializeUuid: serializeUuid,
	isValidBdAddr: isValidBdAddr,
	bdAddrToBuffer: bdAddrToBuffer
});
