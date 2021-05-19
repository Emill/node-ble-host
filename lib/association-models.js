var obj = Object.freeze({
	JUST_WORKS: 0,
	PASSKEY_ENTRY_INIT_INPUTS: 1,
	PASSKEY_ENTRY_RSP_INPUTS: 2,
	PASSKEY_ENTRY_BOTH_INPUTS: 3,
	NUMERIC_COMPARISON: 4,
	
	toString: function(v) {
		for (var key in obj) {
			if (obj.hasOwnProperty(key) && key != "toString" && obj[key] == v) {
				return key;
			}
		}
		return "(unknown)";
	}
});

module.exports = obj;
