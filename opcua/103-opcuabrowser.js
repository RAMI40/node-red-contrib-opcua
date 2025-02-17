/**

 Copyright 2015 Valmet Automation Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.

 **/

module.exports = function (RED) {
    "use strict";
    var opcua = require('node-opcua');
    var coerceNodeId = require("node-opcua-nodeid").coerceNodeId;
    var async = require("async");
    var path = require("path");

    function OpcUaBrowserNode(config) {

        RED.nodes.createNode(this, config);

        this.item = config.item; // OPC UA address: ns=2;i=4 OR ns=3;s=MyVariable
        this.datatype = config.datatype; // String;
        this.topic = config.topic; // ns=3;s=MyVariable from input
        this.items = config.items;

        var node = this;

        var browseTopic = "ns=0;i=85"; // Default root, server Objects

        var opcuaEndpoint = RED.nodes.getNode(config.endpoint);

        var connectionOption = {};
        connectionOption.securityPolicy = opcua.SecurityPolicy[opcuaEndpoint.securityPolicy] || opcua.SecurityPolicy.None;
        connectionOption.securityMode = opcua.MessageSecurityMode[opcuaEndpoint.securityMode] || opcua.MessageSecurityMode.NONE;
        // These are not used, wrong options to get connection to server
        // If certificate is needed then read it through endpoint as bytes
        // connectionOption.certificateFile = path.join(__dirname, "../../node_modules/node-opcua-client/certificates/client_selfsigned_cert_1024.pem");
        // connectionOption.privateKeyFile = path.join(__dirname, "../../node_modules/node-opcua-client/certificates/PKI/own/private/private_key.pem");
        connectionOption.endpoint_must_exist = false;
        node.status({
            fill: "gray",
            shape: "dot",
            text: "no Items"
        });

        node.add_item = function (item) {
            console.log(item);
            if (item) {
                if (!node.items) {
                    node.items = new Array();
                }
                node.items.push({
                    'item': item
                });
            }
        };

        function node_error(err) {
            node.error(err);
        }

        function setupClient(url, callback) {

            // new OPC UA Client and browse from Objects ns=0;s=Objects
            var browseClient = new opcua.OPCUAClient(connectionOption);
            var browseSession;

            async.series([
                // First connect to server´s endpoint
                function (callback) {
                    browseClient.connect(url, callback);
                    node.log("start browse client on " + opcuaEndpoint.endpoint);
                },
                function (callback) {
                    browseClient.createSession(function (err, session) {
                        if (!err) {
                            browseSession = session;
                            node.log("start browse session on " + opcuaEndpoint.endpoint);
                            callback();
                        } else {
                            callback(err);
                        }
                    });
                },
                // step 3 : browse
                function (callback) {
                    node.warn("browseTopic:" + browseTopic);
                    browseSession.browse(coerceNodeId(browseTopic), function (err, browse_result) {
                        console.log(browse_result);
                        if (!err) {
                            var nodes = browse_result.references;
                            if (nodes instanceof Array) {
                                nodes.forEach(function (reference) {
                                    // TODO Fix later 
                                    node.add_item(reference);
                                });
                            }
                        }

                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: "Items: " + node.items.length
                        });

                        callback(err);
                    });
                },
                // close session
                function (callback) {

                    node.warn("sending items " + node.items.length);
                    var msg = {
                        payload: node.items,
                        endpoint: opcuaEndpoint.endpoint
                    };
                    node.send(msg);

                    node.warn("close browse session");
                    browseSession.close(function (err) {
                        if (err) {
                            node_error("session closed failed on browse");
                        }
                        callback(err);
                    });
                }
            ], function (err) {
                if (err) {
                    browseSession = null;
                    browseClient = null;
                    callback(err);
                }
            });
        }

        setupClient(opcuaEndpoint.endpoint, function (err) {
            if (err) {
                node_error(err);
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "Error Items: " + node.items.length
                });
            }

            node.log("Browse loading Items done ...");
        });

        node.on("input", function (msg) {

            browseTopic = null;

            node.warn("input browser");
            
            if (msg.payload.hasOwnProperty('actiontype')) {

                switch (msg.payload.actiontype) {
                    case 'browse':
                        if (msg.payload.hasOwnProperty('root')) {
                            if (msg.payload.root && msg.payload.root.hasOwnProperty('item')) {
                                if (msg.payload.root.item.hasOwnProperty('nodeId')) {
                                    browseTopic = browse_by_item(msg.payload.root.item.nodeId);
                                }
                            }
                        }
                        break;

                    default:
                        break;
                }
            } else {
                if (!node.topic && msg.topic) {
                    if (msg.topic) {
                        browseTopic = msg.topic;
                    }
                } else {
                    browseTopic = node.topic;
                }
            }

            node.items = []; // new Array(); // clear items - TODO: may it becomes usable in Edit window of the node

            if (!browseTopic) {
                browseTopic = browse_to_root();
            }

            setupClient(opcuaEndpoint.endpoint, function (err) {
                if (err) {
                    node_error(err);
                    node.status({
                        fill: "red",
                        shape: "dot",
                        text: "Error Items: " + node.items.length
                    });
                }
                node.log("Browse loading Items done ...");
            });

            msg.endpoint = opcuaEndpoint.endpoint;
            msg.payload = node.items;

            node.send(msg);
        });

        function browse_by_item(nodeId) {
            node.log("Browse to root " + nodeId);
            return nodeId;
        }


        function browse_to_root() {
            node.warn("Browse to root Objects");
            return "ns=0;i=85"; // OPC UA Root Folder Objects
        }
    }

    RED.nodes.registerType("OpcUa-Browser", OpcUaBrowserNode);
};
