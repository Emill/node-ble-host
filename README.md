# node-ble-host

A full-featured Bluetooth Low Energy host stack written in JavaScript.

Use this library to programmatically setup or connect to BLE devices in Node.js on Raspberry Pi or other Linux devices.

## Feature support

* Advertising
* Scanning
  * The API allows for "multiplexing" multiple logical scanners with different filters and parameters onto one physical scanning
* Initiating a connection
  * Possibility to cancel a pending connection
* Peripheral
* Central
* Multiple concurrent GAP roles (scanner, initiator, advertiser, connection etc.) as long as the controller supports it
* Multiple concurrent connections
* GATT server role:
  * GATT database
  * Services, Characteristics, Descriptors, Included Services
  * Modify GATT db _after_ initialization is done
  * MTU Exchange with large MTU
  * Handle requests for Read, Write, Write Without Response, Reliable Write
  * Handle Long Reads, Long Writes
  * Notifications, Indications
  * Either program custom read/write handlers, or let the library handle these automatically
  * Configurable permissions (a specific security level or custom handler)
  * Indications are automatically enqueued and executed after each other, since GATT only allows one outstanding indication
* GATT client role:
  * MTU Exchange with large MTU
  * Service Discovery
  * Service Discovery by Service UUID
  * Cache services on subsequent connections, when allowed by the spec
  * Re-discover services
  * Discover Characteristics, Descriptors, Included Services
  * Read, Write, Write Without Response, Reliable Write
  * Long Read / Long Write (automatically when needed by default or explicitly)
  * Notifications, Indications, Confirmations
  * Requests are automatically enqueued and executed after each other, since GATT only allows one outstanding request
* L2CAP Connection-oriented channels (L2CAP CoC)
  * Server and client support
  * Flow control
* Pairing / Bonding (Security Manager)
  * LE Security Mode 1
  * Encryption of the link
  * Persistent storage of LTK, IRK, Identity Address, GATT cache, cccd state etc. (JSON file-based for now)
  * Supports LE Legacy Pairing as well as LE Secure Connections Pairing (configurable whether SC should be supported)
  * Keypress notifications
  * Configurable Pairing process
  * Configurable I/O capabilities
  * Configurable key distribution

## Setup

Installation:

```
npm install ble-host
```

If you have a Bluetooth LE compatible controller connected to Linux (like a USB dongle or built-in adapter), install the `hci-socket` package from https://github.com/Emill/node-hci-socket:

```
npm install hci-socket
```

In order to access the Bluetooth HCI layer from Node.js, either you will need to run `node` using `sudo` every time or execute ``sudo setcap cap_net_admin=ep $(eval readlink -f `which node`)`` first to give the `node` binary access to use Bluetooth HCI.

## API Documentation

* [BleManager](docs/api/ble-manager.md)
* [GattClient](docs/api/gatt-client.md)
* [GattServer](docs/api/gatt-server.md)
* [Attribute Errors](docs/api/att-errors.md)
* [L2CAP CoC](docs/api/l2cap-coc.md)
* [Security Manager](docs/api/security-manager.md)
* [Advertising Data Builder](docs/api/advertising-data-builder.md)

## Design

The library is asynchronous and is built mostly around callbacks. Events that can happen multiple times and events that do not happen as a result of an operation, use Node.js's Events mechanism.

Most callbacks are passed an error code as the first argument, and the result value(s), if no error occurred, as the following argument(s).

If an operation is to be executed within the context of a connection, for example a GATT Request, but the connection terminates before the response arrives, the corresponding callback will not be called. If logic is needed to handle this, that logic must be put in the `disconnect` event handler instead. Usually this results in cleaner code than having to handle the case that the connection dropped in every callback.

Compared to many other libraries, this implementation has a GATT Client object per connection, not per device. This means every GATT operation executes within the context of a connection. After a re-connection, attempting to execute a GATT operation on the `gatt` object of a previous connection will result in that nothing is sent. This means there will be no accidental writes to "wrong" connections, which is important if there is a state the remote device must be in when an operation is executed. Compare this with TCP connections, where you send data in the context of a socket, not in the context of a remote host.

All GATT values can be either strings or Buffers when writing, but will always be Buffers when read. A string value will be automatically converted to a Buffer using UTF-8 encoding.

## Full GATT Server Example

This example shows how to set up a peripheral with a GATT server with characteristics supporting read, write and notify.

For a characteristic, the value can simply be stored within the characteristic as the `value` property. The library will then internally read or write to this value, when requested by the GATT client. Another way is to attach `onRead` and `onWrite` handlers, to handle the value in a custom way.

The example also shows how to store a characteristic object in a variable (`notificationCharacteristic`) so that we can act upon it later.

An `AdvertisingDataBuilder` is then used to construct the advertising data buffer for us, which we use to start advertising.

After a connection is established as the result of advertising, advertising is automatically stopped by the controller. In order to accept new connections, we restart advertising when a connection disconnects.

```javascript
const HciSocket = require('hci-socket');
const NodeBleHost = require('ble-host');
const BleManager = NodeBleHost.BleManager;
const AdvertisingDataBuilder = NodeBleHost.AdvertisingDataBuilder;
const HciErrors = NodeBleHost.HciErrors;
const AttErrors = NodeBleHost.AttErrors;

const deviceName = 'MyDevice';

var transport = new HciSocket(); // connects to the first hci device on the computer, for example hci0

var options = {
    // optional properties go here
};
BleManager.create(transport, options, function(err, manager) {
    // err is either null or an Error object
    // if err is null, manager contains a fully initialized BleManager object
    if (err) {
        console.error(err);
        return;
    }
    
    var notificationCharacteristic;
    
    manager.gattDb.setDeviceName(deviceName);
    manager.gattDb.addServices([
        {
            uuid: '22222222-3333-4444-5555-666666666666',
            characteristics: [
                {
                    uuid: '22222222-3333-4444-5555-666666666667',
                    properties: ['read', 'write'],
                    value: 'some default value' // could be a Buffer for a binary value
                },
                {
                    uuid: '22222222-3333-4444-5555-666666666668',
                    properties: ['read'],
                    onRead: function(connection, callback) {
                        callback(AttErrors.SUCCESS, new Date().toString());
                    }
                },
                {
                    uuid: '22222222-3333-4444-5555-666666666669',
                    properties: ['write'],
                    onWrite: function(connection, needsResponse, value, callback) {
                        console.log('A new value was written:', value);
                        callback(AttErrors.SUCCESS); // actually only needs to be called when needsResponse is true
                    }
                },
                notificationCharacteristic = {
                    uuid: '22222222-3333-4444-5555-66666666666A',
                    properties: ['notify'],
                    onSubscriptionChange: function(connection, notification, indication, isWrite) {
                        if (notification) {
                            // Notifications are now enabled, so let's send something
                            notificationCharacteristic.notify(connection, 'Sample notification');
                        }
                    }
                }
            ]
        }
    ]);
    
    const advDataBuffer = new AdvertisingDataBuilder()
                            .addFlags(['leGeneralDiscoverableMode', 'brEdrNotSupported'])
                            .addLocalName(/*isComplete*/ true, deviceName)
                            .add128BitServiceUUIDs(/*isComplete*/ true, ['22222222-3333-4444-5555-666666666666'])
                            .build();
    manager.setAdvertisingData(advDataBuffer);
    // call manager.setScanResponseData(...) if scan response data is desired too
    startAdv();

    function startAdv() {
        manager.startAdvertising({/*options*/}, connectCallback);
    }
    
    function connectCallback(status, conn) {
        if (status != HciErrors.SUCCESS) {
            // Advertising could not be started for some controller-specific reason, try again after 10 seconds
            setTimeout(startAdv, 10000);
            return;
        }
        conn.on('disconnect', startAdv); // restart advertising after disconnect
        console.log('Connection established!', conn);
    }
});
```

## Full GATT Client Example

This example shows how to scan for devices advertising a particular service uuid, connect to that device, and how to use GATT read, write operations and how to listen to notifications.

```javascript
const HciSocket = require('hci-socket');
const NodeBleHost = require('ble-host');
const BleManager = NodeBleHost.BleManager;
const AdvertisingDataBuilder = NodeBleHost.AdvertisingDataBuilder;
const HciErrors = NodeBleHost.HciErrors;
const AttErrors = NodeBleHost.AttErrors;

var transport = new HciSocket(); // connects to the first hci device on the computer, for example hci0

var options = {
    // optional properties go here
};
BleManager.create(transport, options, function(err, manager) {
    // err is either null or an Error object
    // if err is null, manager contains a fully initialized BleManager object
    if (err) {
        console.error(err);
        return;
    }
    
    var scanner = manager.startScan({scanFilters: [new BleManager.ServiceUUIDScanFilter('22222222-3333-4444-5555-666666666666')]});
    scanner.on('report', function(eventData) {
        if (eventData.connectable) {
            console.log('Found device named ' + (eventData.parsedDataItems['localName'] || '(no name)') + ':', eventData);
            scanner.stopScan();
            manager.connect(eventData.addressType, eventData.address, {/*options*/}, function(conn) {
                console.log('Connected to ' + conn.peerAddress);
                conn.gatt.exchangeMtu(function(err) { console.log('MTU: ' + conn.gatt.currentMtu); });
                conn.gatt.discoverServicesByUuid('22222222-3333-4444-5555-666666666666', 1, function(services) {
                    if (services.length == 0) {
                        return;
                    }
                    var service = services[0];
                    service.discoverCharacteristics(function(characteristics) {
                        for (var i = 0; i < characteristics.length; i++) {
                            var c = characteristics[i];
                            console.log('Found ' + c.uuid);
                            if (c.properties['read']) {
                                c.read(function(err, value) {
                                    console.log('Read ' + value + ' from ' + c.uuid);
                                });
                            } else if (c.properties['write']) {
                                c.write(Buffer.from([65, 66, 67])); // Can add callback if we want the result status
                            }
                            if (c.properties['notify']) {
                                // Write to the Client Characteristic Configuration Descriptor to enable notifications
                                // Can add callback as the last parameter if we want the result status
                                c.writeCCCD(/*enableNotifications*/ true, /*enableIndications*/ false);
                                c.on('change', function(value) {
                                    console.log('New value:', value);
                                });
                            }
                        }
                    });
                });
                conn.on('disconnect', function(reason) {
                    console.log('Disconnected from ' + conn.peerAddress + ' due to ' + HciErrors.toString(reason));
                });
            });
        }
    });
});
```

## L2CAP Connection-oriented channels

L2CAP CoC is a great feature where you want to just send data packets to and from a device, when the GATT architecture doesn't make sense for your particular use case. For example, GATT has the issue that values can only be up to 512 bytes and the specification allows for notifications to be dropped (even if this implementation never drops notifications), and is generally not made for data transfer of large amounts of data. L2CAP CoC is similar to TCP, with the difference that the data is a sequence of packets, not a sequence of bytes, which usually makes the application code more clean.

Both the server side and and client side L2CAP CoC are supported.

A server can register a PSM on a BLE connection (if we are master or slave is irrelevant):

```javascript
const L2CAPCoCErrors = NodeBleHost.L2CAPCoCErrors;

// 0x0001 - 0x007f for fixed Bluetooth SIG-defined services, 0x0080 - 0x00ff for custom ones.
const lePsm = 0x0080;

conn.l2capCoCManager.registerLePsm(lePsm, function onRequestCallback(txMtu, callback) {
    // txMtu is the maximum packet (SDU) size the peer can receive,
    // which means we should never send a packet larger than this.
    
    // If we would reject, for example due to the reason we can only handle one l2cap connection at a time
    // callback(L2CAPCoCErrors.NO_RESOURCES_AVAILABLE);
    
    // Accept, enable receiving of packets immediately, with maximum receive size of 65535 bytes per packet
    var l2capCoC = callback(L2CAPCoCErrors.CONNECTION_SUCCESSFUL, /*initiallyPaused*/ false, /*rxMtu*/ 65535);
    
    // Now use the l2capCoC object
    ...
});
```

A client can connect using a specific PSM on a BLE connection (if we are master or slave is irrelevant):

```javascript
const L2CAPCoCErrors = NodeBleHost.L2CAPCoCErrors;

// 0x0001 - 0x007f for fixed Bluetooth SIG-defined services, 0x0080 - 0x00ff for custom ones.
const lePsm = 0x0080;

// Request a connection where we enable receiving of packets immediately,
// with maximum receive size of 65535 bytes per packet
conn.l2capCoCManager.connect(lePsm, /*initiallyPaused*/ false, /*rxMtu*/ 65535, function(result, l2capCoC) {
    if (result != L2CAPCoCErrors.CONNECTION_SUCCESSFUL) {
        console.log('L2CAP CoC connection failed: ' + L2CAPCoCErrors.toString(result));
        return;
    }
    
    // Now use the l2capCoC object
    ...
});
```

Whenever a connection is established, it works the same regardless of which side initiated the connection.

Simplest way to send and receive packets:

```javascript
// Sending packets
l2capCoC.send(Buffer.from([1, 2, 3]));

// Receiving packets
l2capCoC.on('data', function(buffer) {
    console.log(buffer);
});
```

The API is designed to work similar to Node.js's TCP or stream API, which means data can be appended to the output queue, even if the remote device is currently not accepting any new incoming packets. In general this results in a simple API that will work fine, except for the case when we attempt to send packets faster than the remote device can handle. To handle this, the `l2capCoC.txCredits` property returns the current balance. If positive, the remote device is ready to accept more packets. If zero, the device is not ready. If negative, we have buffered up some data internally that will be sent as soon as the remote device is ready. We can listen to the `credits` event to detect when the balance is updated. See the API documentation for further details.

The flow control in the receive direction is even simpler and can be controlled by `l2capCoC.pause()` and `l2capCoC.resume()`. The call takes effect immediately, from the API user's point of view. The `initiallyPaused` parameter when creating the connection indicates whether receive flow is paused initially. The difference compared to just calling `l2capCoC.pause()` directly after the connection is created lies within whether we give initial credits to the peer or not.

## Bonding

Bonding is supported and enabled by default. If not configured, "Just Works" pairing will be started automatically when requested by the remote device.

Please read the API documentation for how to customizing the bonding process. As an example, to start pairing explicitly, call `conn.smp.sendPairingRequest(...)` when in the master role and `conn.smp.sendSecurityRequest(...)` when in slave role.

### Passkey example - master

Pairing flow when the local device has a display that will show a passkey that is to be entered on the remote device by the user.

```javascript
const IOCapabilities = NodeBleHost.IOCapabilities;
const AssociationModels = NodeBleHost.AssociationModels;
const SmpErrors = NodeBleHost.SmpErrors;

conn.smp.sendPairingRequest({ioCap: IOCapabilities.DISPLAY_ONLY, bondingFlags: 1});

conn.smp.on('passkeyExchange', function(associationModel, userPasskey, callback) {
    // Note that Just works will be used if the remote device doesn't have a keyboard
    if (associationModel == AssociationModels.PASSKEY_ENTRY_RSP_INPUTS) {
        console.log('Please enter ' + userPasskey + ' on the remote device.');
    }
    // callback would be used to tell the library the passkey the user entered,
    // if we had keyboard input support
});

conn.smp.on('pairingComplete', function(resultObject) {
    console.log('The pairing process is now complete!');
    console.log('MITM protection: ' + conn.smp.currentEncryptionLevel.mitm);
    console.log('LE Secure Connections used: ' + conn.smp.currentEncryptionLevel.sc);
    // Put logic here, e.g. read a protected characteristic
});

conn.smp.on('pairingFailed', function(reason, isErrorFromRemote) {
    console.log('Pairing failed with reason ' + SmpErrors.toString(reason));
});
```

To automatically start encryption after a reconnection, we must do that explicitly when the connection gets established:

```javascript
if (conn.smp.hasLtk) {
    conn.smp.startEncryption();
} else {
    // start pairing here if we want to pair instead if a bond does not exist
}

conn.smp.on('encrypt', function(status, currentEncryptionLevel) {
    if (status != HciErrors.SUCCESS) {
        console.log('Could not start encryption due to ' + HciErrors.toString(status));
        return;
    }
    console.log('The encryption process is now complete!');
    console.log('MITM protection: ' + currentEncryptionLevel.mitm);
    console.log('LE Secure Connections used: ' + currentEncryptionLevel.sc);
    // Put logic here, e.g. read a protected characteristic
});
```

Note that the `encrypt` event will be emitted as well during the pairing process, in case we want a common handler for when the link gets encrypted.

### Passkey example - slave

Pairing flow when the local device has a keyboard where the user can input six digits shown by the other device, or for the case when both devices have a keyboard and the user is requested to input a random passkey on both devices.

```javascript
const IOCapabilities = NodeBleHost.IOCapabilities;
const AssociationModels = NodeBleHost.AssociationModels;
const SmpErrors = NodeBleHost.SmpErrors;

// This only needs to be sent if the remote device doesn't send a pairing request on its own
conn.smp.sendSecurityRequest(/*bond*/ true, /*mitm*/ true, /*sc*/ true, /*keypress*/ false);

// Without this event handler the I/O capabilities will be no input, no output
conn.smp.on('pairingRequest', function(req, callback) {
    callback({ioCap: IOCapabilities.KEYBOARD_ONLY, bondingFlags: 1, mitm: true});
});

conn.smp.on('passkeyExchange', function(associationModel, userPasskey, callback) {
    // Note that Just works will be used if the remote device has no I/O capabilities
    var doInput = false;
    if (associationModel == AssociationModels.PASSKEY_ENTRY_RSP_INPUTS) {
        console.log('Please enter the passkey shown on the other device:');
        doInput = true;
    } else if (associationModel == AssociationModels.PASSKEY_ENTRY_BOTH_INPUTS) {
        console.log('Please enter the same random passkey on both devices:');
        doInput = true;
    }
    if (doInput) {
        process.stdin.once('data', function(buffer) {
            callback(buffer.toString('utf8').replace(/[\r\n]/g, ''));
        });
    }
});

conn.smp.on('pairingComplete', function(resultObject) {
    console.log('The pairing process is now complete!');
    console.log('MITM protection: ' + conn.smp.currentEncryptionLevel.mitm);
    console.log('LE Secure Connections used: ' + conn.smp.currentEncryptionLevel.sc);
    // Put logic here, e.g. read a protected characteristic
});

conn.smp.on('pairingFailed', function(reason, isErrorFromRemote) {
    console.log('Pairing failed with reason ' + SmpErrors.toString(reason));
});
```

The "security request" has two uses. The first is to ask the master to start the pairing procedure. The other is to ask the master to start encryption if there already exists a bond with the requested security level.

To automatically start encryption after a reconnection (in case the master doesn't do that on its own), we send a security request with the same security level as the current key:

```javascript
const IOCapabilities = NodeBleHost.IOCapabilities;
const AssociationModels = NodeBleHost.AssociationModels;
const SmpErrors = NodeBleHost.SmpErrors;

if (conn.smp.hasLtk) {
    var level = conn.smp.availableLtkSecurityLevel;
    conn.smp.sendSecurityRequest(/*bond*/ true, level.mitm, /*sc*/ true, /*keypress*/ false);
}

conn.smp.on('encrypt', function(status, currentEncryptionLevel) {
    if (status != HciErrors.SUCCESS) {
        console.log('Master tried to initiate encryption with a key we do not have');
        return;
    }
    console.log('The encryption process is now complete!');
    console.log('MITM protection: ' + currentEncryptionLevel.mitm);
    console.log('LE Secure Connections used: ' + currentEncryptionLevel.sc);
    // Put logic here, e.g. read a protected characteristic
});
```

### Example - pairing should be disabled

In case we don't want to allow pairing to happen, we must explicitly handle this in the `pairingRequest` event (otherwise Just Works pairing will be used by default):

```javascript
const SmpErrors = NodeBleHost.SmpErrors;

conn.smp.on('pairingRequest', function(req, callback) {
    conn.smp.sendPairingFailed(SmpErrors.PAIRING_NOT_SUPPORTED);
});
```
