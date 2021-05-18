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
* L2CAP Connected oriented Channels (L2CAP CoC)
  * Server and client support
  * Flow control
* Pairing / Bonding (Security Manager)
  * LE Security Mode 1
  * Encryption of the link
  * Persistent storage of LTK, IRK, Identity Address, GATT cache, cccd state etc. (JSON file-based for now)
  * Supports LE Legacy Pairing as well as LE Secure Connections Pairing
  * Keypress notifications
  * Configurable Pairing process
  * Configurable I/O capabilities
  * Configurable key distribution

## Setup

Installation:

```
npm install ble-host
```

If you have a Bluetooth controller connected to Linux (like a USB dongle or built-in adapter), install the `hci-socket` package from https://github.com/Emill/node-hci-socket:

```
npm install hci-socket
```

In order to access the Bluetooth HCI layer from Node.js, either you will need to run `node` using `sudo` every time or execute ``sudo setcap cap_net_admin=ep $(eval readlink -f `which node`)`` first to give the `node` binary access to use Bluetooth HCI.

## Full GATT Server Example

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
    startAdv();

    function startAdv() {
        manager.startAdvertising({}, connectCallback);
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

```javascript
const HciSocket = require('hci-socket');
const NodeBleHost = require('ble-host');
const BleManager = NodeBleHost.BleManager;
const AdvertisingDataBuilder = NodeBleHost.AdvertisingDataBuilder;
const HciErrors = NodeBleHost.HciErrors;
const AttErrors = NodeBleHost.AttErrors;
const CCCDUuid = '0002902-0000-1000-8000-00805F9B34FB'
const EnableNotificationsValue = Buffer.from([1, 0]);

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
                                c.discoverDescriptors(function(descriptors) {
                                    var cccd = descriptors.find(d => d.uuid == CCCDUuid);
                                    if (cccd) {
                                        cccd.write(EnableNotificationsValue);
                                    }
                                });
                                c.on('change', function(value) {
                                    console.log('New value: ', value);
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