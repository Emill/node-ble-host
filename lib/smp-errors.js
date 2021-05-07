var obj = Object.freeze({
	PASSKEY_ENTRY_FAILED: 0x01,
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
