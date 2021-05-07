var obj = Object.freeze({
	HCI_NO_CONNECTION: 0x02,
	HCI_AUTHENTICATION_FAILURE: 0x05,
	HCI_PIN_OR_KEY_MISSING: 0x06, // Sent when refreshing encryption and slave does not have key
	HCI_CONNECTION_TIMEOUT: 0x08,
	HCI_OE_USER_ENDED_CONNECTION: 0x13,
	HCI_OE_LOW_RESOURCES: 0x14,
	HCI_OE_POWER_OFF: 0x15,
	HCI_CONNECTION_TERMINATED: 0x16,
	HCI_UNSUPPORTED_REMOTE_FEATURE: 0x1a,
	HCI_UNSPECIFIED_ERROR: 0x1f,
	HCI_LMP_RESPONSE_TIMEOUT: 0x22,
	HCI_INSTANT_PASSED: 0x28,
	HCI_PAIRING_WITH_UNIT_KEY_NOT_SUPPORTED: 0x29,
	HCI_UNACCEPTABLE_CONN_INTERV: 0x3b,
	HCI_DIRECTED_ADV_TIMEOUT: 0x3c,
	HCI_CONN_TERM_MIC_FAIL: 0x3d,
	HCI_CONN_FAIL_TO_BE_ESTABL: 0x3e,
	
	HCI_COMMAND_DISALLOWED: 0x0c,
	
	toString: function(v) {
		for (var key in obj) {
			if (obj[key] == v && key.substr(0, 4) == "HCI_") {
				return key;
			}
		}
		return "(unknown)";
	}
});

module.exports = obj;
