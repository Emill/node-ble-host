# Security Manager
The Security Manager performs all the pairing, bonding and encryption setup logic. SMP is short for Security Manager Protocol.

In SMP, the device in master role is called the initiator and the device in slave role is called the responder.

## Pairing features object
Where the type PairingFeatures object is used, it should be an object having the following properties (all are optional and may therefore be undefined):
* `ioCap` {number} A constant that describes the current device's IO capabilities (default: `IOCapabilities.NO_INPUT_NO_OUTPUT`), see `IOCapabilities` for allowed values
* `bondingFlags` {number} 1 if a bond is requested, i.e. the resulting keys should be stored persistently, otherwise 0 (default: 1)
* `mitm` {boolean} Whether MITM protection is requested (default: false)
* `sc` {boolean} Whether Secure Connections is supported (default: true)
* `keypress` {boolean} Whether Keypress Notifications are supported (default: false)
* `maxKeySize` {number} Integer between 7 and 16 with max key size to be negotiated (default: 16)
* `initKeyDistr` {Object} The keys which the initiator should distribute
  * `encKey` {boolean} Whether LTK should be distributed (default: true)
  * `idKey` {boolean} Whether IRK and Identity Address should be distributed (default: true)
* `rspKeyDistr` {Object} The keys which the responder should distribute
  * `encKey` {boolean} Whether LTK should be distributed (default: true)
  * `idKey` {boolean} Whether IRK and Identity Address should be distributed (default: true)

## Class: SmpMasterConnection and SmpSlaveConnection
Each BLE connection has one instance of either SmpMasterConnection or SmpSlaveConnection, depending on the role. The `smp` property of the BLE connection contains an SmpMasterConnection instance when the current role is master, otherwise it contains an SmpSlaveConnection instance. Their APIs are very similar.

### smp.setAvailableLtk(ltk, rand, ediv, mitm, sc)
* `ltk` {Buffer} An LTK of length 7 to 16
* `rand` {Buffer} The Random value of length 8 that identifies the LTK
* `ediv` {number} The Encrypted Diversifier that identifies the LTK (16-bit unsigned integer)
* `mitm` {boolean} Whether MITM protection was used when the pairing resulting in the LTK was performed
* `sc` {boolean} Whether the Secure Connections pairing model was used to generate the LTK

This method does normally not need to be called since an available LTK is always read from the bond storage. It can however be used for debugging purposes or if a custom LTK should be used. After this method has been called, this LTK will be used when encryption is later started.

### smp.startEncryption()
* Returns: {boolean} If SMP was in the idle state, true. Otherwise false is returned and this method does nothing.

Starts the encryption for a connection to a device that is bonded. Typically this method is called right after a connection has been established or before a request to a GATT characteristic that needs an encrypted link should be performed.

The `'encrypt'` event will be emitted when the operation completes.

Note: This method is only available for the master role (for the slave role, use `sendSecurityRequest` instead). An LTK must be available, otherwise an error will be thrown. Use the `hasLtk` property to see whether an LTK is available. Beware that unencrypted packets may arrive before the encryption is started.

### smp.sendPairingRequest(req)
* `req` {PairingFeatures} The pairing features
* Returns: {boolean} true if an ongoing pairing procedure is not outstanding, otherwise false and this method does nothing

This method starts the pairing procedure. All properties of the `req` object are optional. For most use cases, the `ioCap` and the `mitm` properties are the only ones that need to be customised.

Note: This method is only available for the master role.

### smp.sendSecurityRequest(bond, mitm, sc, keypress)
* `bond` {boolean} Whether a bond is requested, i.e. if pairing is to be performed, the resulting keys should be stored persistently
* `mitm` {boolean} Whether MITM protection is requested
* `sc` {boolean} Whether the Secure Connections pairing model is supported
* `keypress` {boolean} Whether Keypress Notifications are supported

If the SMP is in the idle state, this method will send a Security Request to the master device. If the master has an LTK for this device, it should start encryption. If not (or if the link is already encrypted), it should start pairing.

### smp.sendPairingFailed(reason)
* `reason` {number} Error code identifying why the pairing failed (see the Errors section below for a list of codes)

If there is an ongoing pairing procedure, cancels this and the `'pairingFail'` event will be emitted when the pairing has successfully been cancelled.

### smp.sendKeypressNotification(notificationType)
* `notificationType` {number} Notification Type

If both devices have set the `keypress` flag in the pairing request/response, this method will send keypress notifications to the remote device. Available notification types:

* 0: Passkey entry started
* 1: Passkey digit entered
* 2: Passkey digit erased
* 3: Passkey cleared
* 4: Passkey entry completed

### smp.isEncrypted
{boolean}

Whether the current link is encrypted or not.

### smp.currentEncryptionLevel
{Object}
  * `mitm` {boolean} Whether MITM protection was used for the key in use
  * `sc` {boolean} Whether Secure Connections were used to generate the key in use
  * `keySize` {number} The key size of the key in use

The current encryption level. This value will be `null` if the link is currently unencrypted.

### smp.isBonded
{boolean}

Whether a bond exists to the current device.

### smp.hasLtk
{boolean}

Whether a bond exists to the current device and an LTK is available that can be used to start the encryption.

### smp.availableLtkSecurityLevel
{Object}
  * `mitm` {boolean} Whether MITM protection was used for the key available
  * `sc` {boolean} Whether Secure Connections were used to generate the key available
  * `keySize` {number} The key size of the key available

The security properties for the available LTK, that can be used to start the encryption. This value will be `null` if no key exists.

### Event: 'pairingRequest'
For a device in the slave role:
* `req` {PairingFeatures} The pairing request
* `callback` {Function} Callback
  * `rsp` {PairingFeatures} The pairing response

This event will be emitted when the initiator sends a Pairing Request. The callback should be called with the responder's pairing features. The features that actually will be used are combined from the request and the response. It's also possible to call the `sendPairingFailed` method if the requested security is below the required level.

If there is no listener for this event, the callback will automatically be called with a response where all values are the default.

For a device in the master role:
* `secReq` {Object} The security request
* `callback` {Function} Callback
  * `req` {PairingFeatures} The pairing request

This event will be emitted when the responder sends a Security Request and when the local or remote device does not possess an LTK with the requested security level (according to `secReq`). The `secReq` will contain the same kind of object as a `PairingFeatures`, but only `bondingFlags`, `mitm`, `sc` and `keypress` will be present. Either the callback should be called, or the `sendPairingRequest` should be called with the pairing features of the initiator. It's also possible to call the `sendPairingFailed` method if the master does not want to initiate a pairing procedure.

If there is no listener for this event, the callback will automatically be called with a request where all values are the default. But if the device is bonded in this case, the pairing will fail if the `mitm` flag is false, the current link is not encrypted, or the used association model would be Just Works.

### Event: 'validatePairingFeatures'
* `pairingFeatures` {PairingFeatures} The combined pairing features
* `callback` {Function} Callback for accepting the pairing features

This event will be emitted when the pairing features have been combined from the request and response. If the device accepts the pairing features, the callback should be called. Otherwise the `sendPairingFailed` method should be called.

If there is no listener for this event, the pairing features will automatically be accepted, unless for some cases if the device is already bonded and the current role is master (see `pairingRequest` under no listener).

### Event: 'passkeyExchange'
* `associationModel` {number} A constant defining which association model being used, see `AssociationModels`
* `userPasskey` {string} or {null} A passkey to display to the user
* `callback` {Function} Callback for passing an entered passkey
  * `passkeyResponse` {number}, {string} or {undefined} A 6-digit passkey the user has entered or `undefined` if the numeric comparison association model is used

This event is emitted when the Passkey Exchange starts. For the relevant association models, the `userPasskey` should be displayed. If the user enters a passkey according to the association model, the callback should be called with the passkey the user enters. For the numeric comparison association model, the callback should be called with no parameters if the user confirms that both devices' values are equal, and otherwise call `sendPairingFailed` with the Numeric Comparison Failed error code.

### Event: 'keypress'
* `notificationType` {number} Notification Type

Can be emitted during the Passkey Exchange when the remote device sends passkey notifications (and both devices support these). See `sendKeypressNotification` for possible notification types.

### Event: 'pairingComplete'
* `res` {Object} Result
  * `sc` {boolean} Whether Secure Connections were used
  * `mitm` {boolean} Whether MITM protection was used
  * `bond` {boolean} Whether bonding occurred
  * `rspEdiv` {number} or {null} 16-bit unsigned Encrypted Diversifier that identifies the responder's LTK
  * `rspRand` {Buffer} or {null} 8-byte Random Value that identifies the responder's LTK
  * `rspLtk` {Buffer} or {null} The responder's LTK
  * `initEdiv` {number} or {null} 16-bit unsigned Encrypted Diversifier that identifies the initiator's LTK
  * `initRand` {Buffer} or {null} 8-byte Random Value that identifies the initiator's LTK
  * `initLtk` {Buffer} or {null} The initiator's LTK
  * `rspIrk` {Buffer}, {null} or {undefined} The responder's IRK
  * `rspIdentityAddress` {Object}, {null} or {undefined} The responder's identity address
    * `addressType` {string} `public` or `random`
    * `address` {string} BD ADDR
  * `initIrk` {Buffer}, {null} or {undefined} The initiator's IRK
  * `initIdentityAddress` {Object}, {null} or {undefined} The initiator's identity address
    * `addressType` {string} `public` or `random`
    * `address` {string} BD ADDR

This event is emitted when the pairing has completed successfully. The `rspIrk` and `rspIdentityAddress` will be `undefined` if the current device is the responder, and the `initIrk` and `initIdentityAddress` will be `undefined` if the current device is the initiator. The other keys and key identifiers will be present if those were distributed, otherwise `null`.

### Event: 'pairingFailed'
* `reason` {number} Reason code (see the Errors section below for a list of codes)
* `isErrorFromRemote` {boolean} If the remote device sent a pairing failed command, otherwise the local device sent the failed command

The pairing has failed and the state for SMP is now idle.

### Event: 'encrypt'
* `status` {number} HCI status code
* `currentEncryptionLevel` {Object} or {undefined} Contains the current encryption level, if success
  * `mitm` {boolean} Whether MITM protection was used for the key in use
  * `sc` {boolean} Whether Secure Connections were used to generate the key in use
  * `keySize` {number} The key size of the key in use

Emitted when the encryption has started, or encryption failed to start. A common error code for when encryption fails to start is the Pin or Key Missing error code.

When in the slave role, the only possible non-success error code is `HciErrors.PIN_OR_KEY_MISSING` which will be emitted when the master tries to start encryption for a key we don't possess.

### Event: 'timeout'
Emitted when the pairing protocol times out (30 seconds after the last packet). When this happens, no more SMP packets can be exchanged anymore on this link. If there are no listeners for this event, the BLE connection will be disconnected.

## Errors

List of reason codes why pairing failed.

```javascript
const NodeBleHost = require('ble-host');
const SmpErrors = NodeBleHost.SmpErrors;
```

### Integer constants

The defined constants below are properties of `SmpErrors`.

Bluetooth SIG assigned constants:

```javascript
PASSKEY_ENTRY_FAILED: 0x01
OOB_NOT_AVAILABLE: 0x02
AUTHENTICATION_REQUIREMENTS: 0x03
CONFIRM_VALUE_FAILED: 0x04
PAIRING_NOT_SUPPORTED: 0x05
ENCRYPTION_KEY_SIZE: 0x06
COMMAND_NOT_SUPPORTED: 0x07
UNSPECIFIED_REASON: 0x08
REPEATED_ATTEMPTS: 0x09
INVALID_PARAMETERS: 0x0a
DHKEY_CHECK_FAILED: 0x0b
NUMERIC_COMPARISON_FAILED: 0x0c
BR_EDR_PAIRING_IN_PROGRESS: 0x0d
CROSS_TRANSPORT_KEY_DERIVATION_GENERATION_NOT_ALLOWED: 0x0e
```

### SmpErrors.toString(code)
* `code` {integer} Error code

Returns the corresponding key (e.g. `PASSKEY_ENTRY_FAILED`) for a given code, or `(unknown)` if not one of the above.

## IOCapabilities

Enumeration of I/O capabilities.

```javascript
const NodeBleHost = require('ble-host');
const IOCapabilities = NodeBleHost.IOCapabilities;
```

```javascript
DISPLAY_ONLY: 0x00
DISPLAY_YES_NO: 0x01
KEYBOARD_ONLY: 0x02
NO_INPUT_NO_OUTPUT: 0x03
KEYBOARD_DISPLAY: 0x04
```

### IOCapabilities.toString(value)
* `value` {integer} Feature

Returns the corresponding key (e.g. `DISPLAY_ONLY`) for a given code, or `(unknown)` if not one of the above.

## AssociationModels

Enumeration of association models.

```javascript
const NodeBleHost = require('ble-host');
const AssociationModels = NodeBleHost.AssociationModels;
```

```javascript
JUST_WORKS: 0
PASSKEY_ENTRY_INIT_INPUTS: 1
PASSKEY_ENTRY_RSP_INPUTS: 2
PASSKEY_ENTRY_BOTH_INPUTS: 3
NUMERIC_COMPARISON: 4
```

### AssociationModels.toString(value)
* `value` {integer} Association model

Returns the corresponding key (e.g. `JUST_WORKS`) for a given code, or `(unknown)` if not one of the above.
