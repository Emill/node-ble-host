# L2CAP CoC

This implements support for Connection-Oriented Channel in LE Credit Based Flow Control Mode.

### PSMs
PSM is short for Protocol/Service Multiplexer and serves as an identifier of a protocol/service when establishing a CoC. The currently valid values for LE PSMs are 0x0001 - 0x007f for fixed Bluetooth SIG-defined services, and 0x0080 - 0x00ff for dynamic "custom" services. The establishment is server-client-based, where a server registers a PSM so that clients can later connect to this service. Usually, for custom services, the server selects a PSM value in the range 0x0080 to 0x00ff which should be placed in the GATT db (in an implementation-defined way) so that the client can obtain the PSM. For custom setups where interopability is not required, the PSM can also be hardcoded by both the server and client.

## Class: L2CAPCoCManager

This class is used to register PSMs and create CoC connections. Each BLE connection object has an instance of an L2CAPCoCManager, which can be retrieved through its `l2capCoCManager` property.

### l2capCoCManager.connect(lePsm, initiallyPaused, rxMtu, callback)
* `lePsm` {number} Integer in the range 0x0001 - 0x00ff which identifies the protocol/service to connect to
* `initiallyPaused` {boolean} Whether the RX flow is initially stopped (i.e. no initial credits given to peer)
* `rxMtu` {number} 16-bit unsigned integer (at least 23) of how large each packet (SDU) the peer is allowed to send to us
* `callback` {Function} Callback

Creates a CoC between this device and the remote device, for a PSM that the remote device has registered.

Callback should take two arguments `result` and `coc`, where `result` is an integer from `L2CAPCoCErrors` and `coc` is an `L2CAPCoC` object (`undefined` if result was not success).

### l2capCoCManager.registerLePsm(lePsm, onRequestCallback)
* `lePsm` {number} Integer in the range 0x0001 - 0x00ff which identifies the protocol/service to register
* `onRequestCallback` {Function} Callback

Registers a PSM so that the remote peer can create a CoC using this PSM. If the PSM is already registered, the `onRequestCallback` will simply be replaced with the new one.

`onRequestCallback` should take two arguments `txMtu` and `callback`. `txMtu` is the maximum packet (SDU) size the peer can receive.

`callback` should be called in order to reject or accept the connection requests and takes the following arguments:
* `result` {number} A result code from `L2CAPCoCErrors`
* `initiallyPaused` {boolean} Whether the RX flow is initially stopped (i.e. no initial credits given to peer)
* `rxMtu` {number} 16-bit unsigned integer (at least 23) of how large each packet (SDU) the peer is allowed to send to us
* Returns: {L2CAPCoC} if result is success, otherwise `undefined`

### l2capCoCManager.unregisterLePsm(lePsm)
* `lePsm` {number} A PSM previously registered

Unregisters a PSM so that new connections are not allowed. Previously established CoCs are not affected.

## Class: L2CAPCoC

This represents a Connection-Oriented Channel to the remote device with flow control. Flow control is possible due to each side has a credit balance which is decreased each time an LE-frame is sent. The receiving device will send new credits to the sending device when the sending device's credits are about to run out unless the receiving device has stopped the flow (because it needs time to process the data for example).

This implementation has a `send` method which will always accept a packet (of size up to `txMtu`). If the credits have run out, it will instead be enqueued and the outgoing flow control will be managed internally. To add custom flow control, check the property `txCredits`. If it is positive, you may send a packet. If it is zero or negative, wait for the `credits` event and try again.

For flow control in the receiving direction, there are the methods `pause` and `resume`. Between the calls to `pause` and `resume`, no `data` events will be emitted.

### l2capCoC.send(sdu[, sentCallback][, completeCallback])
* `sdu` {Buffer} A buffer of size up to `txMtu` to send
* `sentCallback` {Function} or {undefined} A callback when the whole SDU has been sent to the controller
* `completeCallback` {Function} or {undefined} A callback when the whole SDU has been acknowledged by the peer's Link Layer or been flushed due to disconnection of the link

Sends a packet. The `txCredits` property will be decreased with as many LE-frames this SDU takes up. The number of LE-frames an SDU takes up can be calculated using `Math.ceil((2 + sdu.length) / l2capCoC.txMps)`.

If the CoC has been disconnected, this method does nothing.

### l2capCoC.disconnect()
Disconnects this CoC. No more `credits` events will be emitted from now on and all incoming data destinated to this CoC will be discarded. Enqueued outgoing SDUs will not be sent. To be sure the CoC is not disconnected before all outgoing data has been sent, wait for the `sentCallback` for the last outgoing SDU before disconnecting.

The `disconnect` event will be emitted immediately.

If the CoC has already been disconnected, this method does nothing.

### l2capCoC.pause()
Pauses RX for this CoC. No `data` events will be emitted until `resume` has been called. No new credits will be given to the sender, but if packets are received (using credits that were left), those will be buffered internally and emitted when the `resume` method is called.

### l2capCoC.resume()
Resumes RX for this CoC. `data` events will first be emitted immediately for possible SDUs that were received while the CoC was paused. From now on `data` events will be emitted directly when an SDU is received. In case the CoC or BLE link became disconnected while there were still buffered packets, those SDUs will still be emitted (immediately) to the `data` event.

### Event: 'data'
* `sdu` {Buffer} An SDU received

Emitted when an SDU is received.

Note that **data will be lost** if there is no listener registered at the time `data` is emitted.

### Event: 'disconnect'
Emitted when either the local or remote device disconnects the CoC, or when the remote device misbehaves (per specification).

### Event: 'credits'
* `credits` {number} 16-bit unsigned integer with the number of credits to increase the current balance with

Emitted when the remote device gives new credits. To get the new updated current TX credit balance, read the `txCredits` property.

### l2capCoC.txMps
The TX MPS used. This is the maximum number of bytes of each TX LE-frame.

### l2capCoC.txMtu
The TX MTU used. This is the maximum number of bytes of each TX SDU, i.e. the maximum size of the Buffer for the `send` method.

### l2capCoC.txCredits
The current balance for TX packets. If this is positive, indicates how many LE-frames that can be sent directly without the need to be buffered. If this is negative, indicates how many LE-frames have been buffered, waiting for new credits to be received until they can be sent.

## Errors

List of L2CAP CoC errors for accepting or rejecting a connection.

```javascript
const NodeBleHost = require('node-ble-host');
const L2CAPCoCErrors = NodeBleHost.L2CAPCoCErrors;
```

### Integer constants

The defined constants below are properties of `L2CAPCoCErrors`.

Bluetooth SIG assigned constants:

```javascript
CONNECTION_SUCCESSFUL: 0
LE_PSM_NOT_SUPPORTED: 2
NO_RESOURCES_AVAILABLE: 4
INSUFFICIENT_AUTHENTICATION: 5
INSUFFICIENT_AUTHORIZATION: 6
INSUFFICIENT_ENCRYPTION_KEY_SIZE: 7
INSUFFICIENT_ENCRYPTION: 8
INVALID_SOURCE_CID: 9
SOURCE_CID_ALREADY_ALLOCATED: 10
UNACCEPTABLE_PARAMETERS: 11
```

Custom constants:

```javascript
TIMEOUT: -1
```

### L2CAPCoCErrors.toString(code)
* `code` {integer} Error code

Returns the corresponding key (e.g. `CONNECTION_SUCCESSFUL`) for a given code, or `(unknown)` if not one of the above.
