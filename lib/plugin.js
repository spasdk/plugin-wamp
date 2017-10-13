/**
 * @author Stanislav Kalashnik <darkpark.main@gmail.com>
 * @license GNU GENERAL PUBLIC LICENSE Version 3
 */

'use strict';

var Wamp     = require('cjs-wamp'),
    PluginTemplate = require('spa-plugin'),
    message  = PluginTemplate.prototype.app.message,
    clientId = 1,
    targetId = 1,
    clients  = {},
    targets  = {};


/**
 * @constructor
 * @extends PluginTemplate
 *
 * @param {Object} config init parameters (all inherited from the parent)
 */
function Plugin ( config ) {
    var self = this;

    // parent constructor call
    PluginTemplate.call(this, config);

    // create tasks for profiles
    this.profiles.forEach(function ( profile ) {
        var server, serverDone;

        // main entry task
        profile.task(self.entry, function ( done ) {
            server = new (require('ws').Server)({port: profile.data.port});
            serverDone = done;

            // ready
            server.on('listening', function listening () {
                /* eslint no-underscore-dangle: 0 */
                self.debug('start server on port ' + server._server.address().port);
            });

            // new connect
            server.on('connection', function ( connection, incomingMessage ) {
                var urlPath = incomingMessage.url.slice(1).split('/'),
                    methods = {};

                // wrap
                connection = {
                    wamp: new Wamp(connection),
                    type: urlPath[0],
                    host: incomingMessage.connection.remoteAddress,
                    data: {}  // client or target data
                };

                // setup pool
                switch ( connection.type ) {
                    case 'client':
                        connection.id = clientId++;
                        clients[connection.id] = connection;
                        break;
                    case 'target':
                        // connection id is given in the url
                        if ( urlPath[1] ) {
                            connection.id = parseInt(urlPath[1], 10);
                        }

                        // not given or already used
                        if ( !connection.id || connection.id in targets ) {
                            connection.id = targetId++;
                        }

                        targets[connection.id] = connection;
                        break;
                    default:
                        self.debug('wrong connection type');
                        connection.wamp.socket.close();

                        return;
                }

                self.debug('new ' + connection.type + ' connection #' + connection.id + ' from ' + connection.host);

                // general API methods and events
                //connection.wamp.addListeners({
                methods = {
                    getConnectionInfo: function ( params, callback ) {
                        callback(null, {
                            id:   connection.id,
                            type: connection.type,
                            host: connection.host
                        });
                    },
                    getProjectInfo: function ( params, callback ) {
                        callback(null, {
                            host: self.app.host,
                            path: self.app.paths.root,
                            package: self.app.package
                        });
                    },
                    getMemoryUsage: function ( params, callback ) {
                        callback(null, process.memoryUsage());
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

                        for ( name in self.app.plugins ) {
                            data[name] = {
                                name: self.app.plugins[name].name,
                                //config: app.plugins[name].config
                                config: 'Converting circular structure to JSON in SASS'
                            };
                        }

                        callback(null, data);
                    },
                    getTasks: function ( params, callback ) {
                        var data = {};

                        Object.keys(self.app.runner.tasks).sort().forEach(function ( id ) {
                            data[id] = {
                                running: !!self.app.runner.tasks[id].running
                            };
                        });

                        callback(null, data);
                    },
                    runTask: function ( params, callback ) {
                        self.app.runner.run(params.id);

                        // todo: return run status
                        if ( callback ) {
                            callback(null, true);
                        }
                    }
                };

                // API for clients only
                if ( connection.type === 'client' ) {
                    // proxy request to the target
                    methods.getLinkData = function ( params, callback ) {
                        var target = targets[params.targetId];

                        if ( target ) {
                            target.wamp.call('getLinkData', {id: params.linkId}, function ( error, data ) {
                                callback(error, data);
                            });
                        } else {
                            callback(true);
                        }
                    };

                    // proxy code evaluation to the target
                    methods.evalCode = function ( params, callback ) {
                        var target = targets[params.targetId];

                        if ( target ) {
                            target.wamp.call('evalCode', {code: params.code}, function ( error, data ) {
                                callback(error, data);
                            });
                        } else {
                            callback(true);
                        }
                    };
                }

                // API for targets only
                if ( connection.type === 'target' ) {
                    methods.sendMessage = function ( params ) {
                        //self.message(params);
                        profile.notify(params);
                    };
                }

                // apply all listeners
                Object.keys(methods).forEach(function ( name ) {
                    connection.wamp.addListener(name, methods[name]);
                });

                connection.wamp.socket.on('error', function ( event ) {
                    self.debug('wamp.socket error', event);
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

                    self.debug('end ' + connection.type + ' connection #' + connection.id + ' from ' + connection.host);
                });

                // notify all clients about new targets
                if ( connection.type === 'target' ) {
                    Object.keys(clients).forEach(function ( id ) {
                        clients[id].wamp.call('eventTargetOnline', {
                            id:   connection.id,
                            host: connection.host
                        });
                    });
                }
            });

            self.app.runner.addListener('start', function ( event ) {
                Object.keys(clients).forEach(function ( id ) {
                    clients[id].wamp.call('eventTaskStart', event);
                });
            });

            self.app.runner.addListener('finish', function ( event ) {
                Object.keys(clients).forEach(function ( id ) {
                    clients[id].wamp.call('eventTaskFinish', event);
                });
            });
        });

        profile.task('stop', function () {
            if ( server ) {
                profile.notify({
                    info: 'stop',
                    tags: [self.entry]
                });

                server.close();
                server = null;
                serverDone();
            }
        });
    });

    this.debug('tasks: ' + Object.keys(this.tasks).sort().join(', '));
}


// inheritance
Plugin.prototype = Object.create(PluginTemplate.prototype);
Plugin.prototype.constructor = Plugin;


// ???
// Plugin.prototype.message = function ( data ) {
//     Object.keys(clients).forEach(function ( id ) {
//         clients[id].wamp.call('eventTargetMessage', data);
//     });
// };


PluginTemplate.prototype.app.message = function ( data, config ) {
    var webuiConfig;

    // sanitize
    data   = data   || {};
    config = config || {};

    // extract type configs
    webuiConfig = config.webui[data.type];

    //console.log(config);
    //console.log(data.type);

    // cli logging
    message(data, config);

    // browser logging
    if ( webuiConfig ) {
    //if ( config && config.webui[data.type] && config.webui[data.type].show ) {
        Object.keys(clients).forEach(function ( id ) {
            clients[id].wamp.call('eventTargetMessage', data);
            //console.log('send by wamp to client#' + id);
        });
    }
};


// public
module.exports = Plugin;
