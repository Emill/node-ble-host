var obj = Object.freeze({
	TIMEOUT: -1,
	CONNECTION_SUCCESSFUL: 0,
	LE_PSM_NOT_SUPPORTED: 2,
	NO_RESOURCES_AVAILABLE: 4,
	INSUFFICIENT_AUTHENTICATION: 5,
	INSUFFICIENT_AUTHORIZATION: 6,
	INSUFFICIENT_ENCRYPTION_KEY_SIZE: 7,
	INSUFFICIENT_ENCRYPTION: 8,
	INVALID_SOURCE_CID: 9,
	SOURCE_CID_ALREADY_ALLOCATED: 10,
	UNACCEPTABLE_PARAMETERS: 11,
	
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
