/**
 * @author Stanislav Kalashnik <darkpark.main@gmail.com>
 * @license GNU GENERAL PUBLIC LICENSE Version 3
 */

'use strict';

var Wamp     = require('cjs-wamp'),
    Plugin   = require('spasdk/lib/plugin'),
    app      = require('spasdk/lib/app'),
    plugin   = new Plugin({name: 'wamp', entry: 'serve', config: require('./config')}),
    clientId = 1,
    targetId = 1,
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
                wamp: new Wamp(connection),
                type: connection.upgradeReq.url.slice(1).split('/')[0],
                host: connection.upgradeReq.connection.remoteAddress,
                data: {}  // client or target data
            };

            // setup pool
            switch ( connection.type ) {
                case 'client':
                    connection.id = clientId++;
                    clients[connection.id] = connection;
                    break;
                case 'target':
                    connection.id = targetId++;
                    targets[connection.id] = connection;
                    break;
                default:
                    plugin.debug('wrong connection type');
                    return connection.wamp.socket.close();
            }

            plugin.debug('new '.green + connection.type.bold + ' connection #' + connection.id + ' from ' + connection.host.bold);

            // general API methods and events
            connection.wamp.addListeners({
                getInfo: function ( params, callback ) {
                    callback(null, {
                        path: app.paths.root,
                        package: app.package
                    });
                },
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
                },
                getPlugins: function ( params, callback ) {
                    var data = {},
                        name;

                    for ( name in app.plugins ) {
                        data[name] = {
                            name:   app.plugins[name].name,
                            config: app.plugins[name].config
                        };
                    }

                    callback(null, data);
                },
                getTasks: function ( params, callback ) {
                    var data = {},
                        id;

                    for ( id in app.runner.tasks ) {
                        data[id] = {
                            running: !!app.runner.tasks[id].running
                        };
                    }
                    callback(null, data);
                },
                runTask: function ( params, callback ) {
                    app.runner.run(params.id);

                    // todo: return run status
                    callback(null, true);
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

            // notify all clients about new targets
            if ( connection.type === 'target' ) {
                Object.keys(clients).forEach(function ( id ) {
                    clients[id].wamp.call('eventTargetOnline', {id: connection.id});
                });
            }
        });

        app.runner.addListener('start', function ( event ) {
            Object.keys(clients).forEach(function ( id ) {
                clients[id].wamp.call('eventTaskStart', event);
            });
        });

        app.runner.addListener('finish', function ( event ) {
            Object.keys(clients).forEach(function ( id ) {
                clients[id].wamp.call('eventTaskFinish', event);
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


plugin.message = function ( data ) {
    Object.keys(clients).forEach(function ( id ) {
        clients[id].wamp.call('message', data);
    });
};

// public
module.exports = plugin;
