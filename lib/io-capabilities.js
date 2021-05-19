var obj = Object.freeze({
	DISPLAY_ONLY: 0x00,
	DISPLAY_YES_NO: 0x01,
	KEYBOARD_ONLY: 0x02,
	NO_INPUT_NO_OUTPUT: 0x03,
	KEYBOARD_DISPLAY: 0x04,
	
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
