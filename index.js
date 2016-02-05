/**
 * @author Stanislav Kalashnik <darkpark.main@gmail.com>
 * @license GNU GENERAL PUBLIC LICENSE Version 3
 */

'use strict';

var Wamp     = require('cjs-wamp'),
    Plugin   = require('spasdk/lib/plugin'),
    plugin   = new Plugin({name: 'wamp', entry: 'serve', config: require('./config')}),
    uniqueId = 1,
    clients  = {},
    targets  = {};


// create tasks for profiles
plugin.profiles.forEach(function ( profile ) {
    var server;

    // main entry task
    profile.task(plugin.entry, function ( done ) {
        server = new (require('ws').Server)({port: profile.data.port});

        // ready
        server.on('listening', function listening () {
            plugin.debug('start '.green + ('server on port ' + server._server.address().port).bold);
        });

        // new connect
        server.on('connection', function connection ( connection ) {
            // wrap
            connection = {
                id:   uniqueId++,
                wamp: new Wamp(connection),
                type: connection.upgradeReq.url.slice(1).split('/')[0],
                host: connection.upgradeReq.connection.remoteAddress,
                data: {}  // client or target data
            };

            // setup pool
            switch ( connection.type ) {
                case 'client':
                    clients[connection.id] = connection;
                    break;
                case 'target':
                    targets[connection.id] = connection;
                    break;
                default:
                    plugin.debug('wrong connection type');
                    return connection.wamp.socket.close();
            }

            plugin.debug('new '.green + connection.type.bold + ' connection #' + connection.id + ' from ' + connection.host.bold);

            // general API methods and events
            connection.wamp.addListeners({
                getClients: function ( params, callback ) {
                    var data = {},
                        id;

                    for ( id in clients ) {
                        data[id] = {
                            host: clients[id].host,
                            data: clients[id].data
                        };
                    }

                    callback(null, data);
                },
                getTargets: function ( params, callback ) {
                    var data = {},
                        id;

                    for ( id in targets ) {
                        data[id] = {
                            host: targets[id].host,
                            data: targets[id].data
                        };
                    }

                    callback(null, data);
                }
            });

            // API for clients only
            if ( connection.type === 'client' ) {
                connection.wamp.addListeners({
                    getPackages: function ( params, callback ) {
                        // ...

                        callback(null, {});
                    }
                });
            }

            // API for targets only
            if ( connection.type === 'target' ) {
                connection.wamp.addListeners({
                    setTarget: function ( params, callback ) {
                        clients.forEach(function ( client ) {
                            client.wamp.call('eventTargetOnline', {});
                        });
                    }
                });
            }

            connection.wamp.socket.on('error', function ( event ) {
                plugin.debug('wamp.socket error', event);
            });

            connection.wamp.socket.on('close', function () {
                var id;

                if ( connection.type === 'client' ) {
                    delete clients[connection.id];
                } else if ( connection.type === 'target' ) {
                    delete targets[connection.id];

                    for ( id in clients ) {
                        clients[id].wamp.call('eventTargetOffline', {id: connection.id});
                    }
                }

                plugin.debug('end '.red + connection.type.bold + ' connection #' + connection.id + ' from ' + connection.host.bold);
            });
        });
    });

    profile.task('stop', function () {
        if ( server ) {
            profile.notify({
                info: 'stop '.green + srcDir.bold,
                title: 'stop',
                message: 'stop ' + srcDir
            });

            server.close();
        }
    });
});


// public
module.exports = plugin;
