'use strict';
/**
 * A node-style callback as used by {@link logic} and {@link modules}.
 * @see {@link https://nodejs.org/api/errors.html#errors_node_js_style_callbacks}
 * @callback nodeStyleCallback
 * @param {?Error} error - Error, if any, otherwise `null`.
 * @param {Data} data - Data, if there hasn't been an error.
 */
/**
 * A triggered by setImmediate callback as used by {@link logic}, {@link modules} and {@link helpers}.
 * Parameters formats: (cb, error, data), (cb, error), (cb).
 * @see {@link https://nodejs.org/api/timers.html#timers_setimmediate_callback_args}
 * @callback setImmediateCallback
 * @param {function} cb - Callback function.
 * @param {?Error} [error] - Error, if any, otherwise `null`.
 * @param {Data} [data] - Data, if there hasn't been an error and the function should return data.
 */

/**
 * Main entry point.
 * Loads the ETP modules, the ETP api and run the express server as Domain master.
 * CLI options available.
 * @module app
 */

//hotam: app monitoring configuration on console/UI 
require('appmetrics-dash').monitor();

// App Monitoring on console
var appmetrics = require('appmetrics');
var monitoring = appmetrics.monitor();

monitoring.on('initialized', function (env) {
	//console.log(chalk.green('initialized') + ' : ' + chalk.yellow('[ETPCoinMetric] init'));
});

monitoring.on('socketio', function (data) {
	//console.log(chalk.green('socketio') + ' : ' + chalk.yellow('[ETPCoinMetric] duration='+data.duration+' ms url='+data.url+' method='+data.method+' event='+data.event));
});

monitoring.on('http', function (data) {
	// console.log(chalk.green('http') + ' : ' +chalk.yellow('[ETPCoinMetric] duration='+data.duration+' ms url='+data.url));
});

monitoring.on('postgres', function (data) {
	//	console.log(chalk.green('postgres') + ' : ' +chalk.yellow('[ETPCoinMetric] duration='+data.duration+' ms query='+data.query));
});

monitoring.on('redis', function (data) {
	//console.log(chalk.green('redis') + ' : ' +chalk.yellow('[ETPCoinMetric] duration='+data.duration+' ms cmd='+data.cmd));
});


//Requiring Modules
require('dotenv').config();
var async = require('async');
var extend = require('extend');
var fs = require('fs');
var chalk = require('chalk');
var checkIpInList = require('./helpers/checkIpInList.js');
var genesisblock = require('./genesisBlock.json');
var git = require('./helpers/git.js');
var https = require('https');
var packageJson = require('./package.json');
var path = require('path');
var program = require('commander');
var httpApi = require('./helpers/httpApi.js');
var Sequence = require('./helpers/sequence.js');
var util = require('util');
var z_schema = require('./helpers/z_schema.js');
var currentDay = '';
const Logger = require('./logger.js');
let logman = new Logger();
let logger = logman.logger;
var sockets = [];
var cron = require('node-cron');
var utils = require('./utils');
var sql = require('./sql/etp');

process.stdin.resume();

var versionBuild = fs.readFileSync(path.join(__dirname, 'build'), 'utf8');

/**
 * @property {string} - Hash of last git commit.
 */
var lastCommit = '';

if (typeof gc !== 'undefined') {
	setInterval(function () {
		gc();
	}, 60000);
}



program
	.version(packageJson.version)
	.option('-c, --config <path>', 'config file path')
	.option('-p, --port <port>', 'listening port number')
	.option('-a, --address <ip>', 'listening host name or ip')
	.option('-x, --peers [peers...]', 'peers list')
	.option('-l, --log <level>', 'log level')
	.option('-s, --snapshot <round>', 'verify snapshot')
	.parse(process.argv);


/**
 * @property {object} - The default list of configuration options. Can be updated by CLI.
 * @default 'config.json'
 */
var appConfig = require('./helpers/config.js')(program.config);

if (program.port) {
	appConfig.port = program.port;
}

if (program.address) {
	appConfig.address = program.address;
}

if (program.peers) {
	if (typeof program.peers === 'string') {
		appConfig.peers.list = program.peers.split(',').map(function (peer) {
			peer = peer.split(':');
			return {
				ip: peer.shift(),
				port: peer.shift() || appConfig.port
			};
		});
	} else {
		appConfig.peers.list = [];
	}
}

if (program.log) {
	appConfig.consoleLogLevel = program.log;
}

if (program.snapshot) {
	appConfig.loading.snapshot = Math.abs(
		Math.floor(program.snapshot)
	);
}

if (process.env.NODE_ENV === 'test') {
	appConfig.coverage = true;
}

// Define top endpoint availability
process.env.TOP = appConfig.topAccounts;

/**
 * The config object to handle ETP modules and ETP api.
 * It loads `modules` and `api` folders content.
 * Also contains db configuration from config.json.
 * @property {object} db - Config values for database.
 * @property {object} modules - `modules` folder content.
 * @property {object} api - `api/http` folder content.
 */
var config = {
	db: appConfig.db,
	cache: appConfig.redis,
	cacheEnabled: appConfig.cacheEnabled,
	modules: {
		server: './modules/server.js',
		accounts: './modules/accounts.js',
		transactions: './modules/transactions.js',
		blocks: './modules/blocks.js',
		signatures: './modules/signatures.js',
		transport: './modules/transport.js',
		loader: './modules/loader.js',
		system: './modules/system.js',
		peers: './modules/peers.js',
		delegates: './modules/delegates.js',
		rounds: './modules/rounds.js',
		multisignatures: './modules/multisignatures.js',
		dapps: './modules/dapps.js',
		crypto: './modules/crypto.js',
		sql: './modules/sql.js',
		cache: './modules/cache.js',
		contracts: './modules/contracts.js',
		frogings: './modules/frogings.js',
		sendFreezeOrder: './modules/sendFreezeOrder.js'
	},
	api: {
		accounts: { http: './api/http/accounts.js' },
		blocks: { http: './api/http/blocks.js' },
		dapps: { http: './api/http/dapps.js' },
		delegates: { http: './api/http/delegates.js' },
		loader: { http: './api/http/loader.js' },
		multisignatures: { http: './api/http/multisignatures.js' },
		peers: { http: './api/http/peers.js' },
		server: { http: './api/http/server.js' },
		signatures: { http: './api/http/signatures.js' },
		transactions: { http: './api/http/transactions.js' },
		transport: { http: './api/http/transport.js' },
		frogings: { http: './api/http/froging.js' },
		sendFreezeOrder: { http: './api/http/transferorder.js' }
	}
};

//merge environment variables
var env = require('./config/env');
utils.merge(appConfig, env);

// Trying to get last git commit
try {
	lastCommit = git.getLastCommit();
} catch (err) {
	logger.debug('Cannot get last git commit', err.message);
}

/**
 * Creates the express server and loads all the Modules and logic.
 * @property {object} - Domain instance.
 */
var d = require('domain').create();

d.on('error', function (err) {
	console.log('error : ', err);
	logger.error('Domain master', { message: err.message, stack: err.stack });
	process.exit(0);
});

// runs domain
d.run(function () {
	var modules = [];
	async.auto({
		/**
		 * Loads `payloadHash` and generate dapp password if it is empty and required.
		 * Then updates config.json with new random  password.
		 * @method config
		 * @param {nodeStyleCallback} cb - Callback function with the mutated `appConfig`.
		 * @throws {Error} If failed to assign nethash from genesis block.
		 */
		config: function (cb) {
			try {
				appConfig.nethash = Buffer.from(genesisblock.payloadHash, 'hex').toString('hex');
			} catch (e) {
				logger.error('Failed to assign nethash from genesis block');
				throw Error(e);
			}

			if (appConfig.dapp.masterrequired && !appConfig.dapp.masterpassword) {
				var randomstring = require('randomstring');

				appConfig.dapp.masterpassword = randomstring.generate({
					length: 12,
					readable: true,
					charset: 'alphanumeric'
				});

				if (appConfig.loading.snapshot != null) {
					delete appConfig.loading.snapshot;
				}
				fs.writeFileSync('./config.json', JSON.stringify(appConfig, null, 4));
				cb(null, appConfig);
			} else {
				cb(null, appConfig);
			}
		},

		logger: function (cb) {
			cb(null, logger);
		},

		build: function (cb) {
			cb(null, versionBuild);
		},

		/**
		 * Returns hash of last git commit.
		 * @method lastCommit
		 * @param {nodeStyleCallback} cb - Callback function with Hash of last git commit.
		 */
		lastCommit: function (cb) {
			cb(null, lastCommit);
		},

		genesisblock: function (cb) {
			cb(null, {
				block: genesisblock
			});
		},

		public: function (cb) {
			cb(null, path.join(__dirname, 'public'));
		},

		schema: function (cb) {
			cb(null, new z_schema());
		},

		/**
		 * Once config is completed, creates app, http & https servers & sockets with express.
		 * @method network
		 * @param {object} scope - The results from current execution,
		 * at leats will contain the required elements.
		 * @param {nodeStyleCallback} cb - Callback function with created Object: 
		 * `{express, app, server, io, https, https_io}`.
		 */
		network: ['config', function (scope, cb) {
			var express = require('express');
			var http = require('http');
			var compression = require('compression');
			var cors = require('cors');
			var app = express();

			//Hotam Singh
			/**
			 * This creates the module that we created in the step before.
			 * In my case it is stored in the util folder.
			 */
			var Prometheus = require('./prometheus');

			/**
			 * The below arguments start the counter functions
			 */
			app.use(Prometheus.requestCounters);
			app.use(Prometheus.responseCounters);

			/**
			 * Enable metrics endpoint
			 */
			Prometheus.injectMetricsRoute(app);

			/**
			 * Enable collection of default metrics
			 */
			Prometheus.startCollection();

			//hotam: added swagger configuration
			var subpath = express();
			var swagger = require("swagger-node-express");
			app.use("/v1", subpath);
			swagger.setAppHandler(subpath);
			subpath.use(express.static('dist'));
			swagger.setApiInfo({
				title: "example API",
				description: "API to do something, manage something...",
				termsOfServiceUrl: "",
				contact: "hotam.singh@oodlestechnologies.com",
				license: "",
				licenseUrl: ""
			});
			subpath.get('/', function (req, res) {
				res.sendFile(__dirname + '/dist/index.html');
			});
			swagger.configureSwaggerPaths('', 'api-docs', '');
			var domain = scope.config.swaggerDomain || 'localhost';
			var applicationUrl = 'http://' + domain;
			swagger.configure(applicationUrl, '1.0.0');

			if (appConfig.coverage) {
				var im = require('istanbul-middleware');
				logger.debug('Hook loader for coverage - do not use in production environment!');
				im.hookLoader(__dirname);
				app.use('/coverage', im.createHandler());
			}

			require('./helpers/request-limiter')(app, appConfig);

			app.use(compression({ level: 9 }));
			app.use(cors());
			app.options('*', cors());

			var server = require('http').createServer(app);
			var io = require('socket.io')(server);

			//hotam: handled socket's connection event
			io.on('connection', function (socket) {
				//IIFE: function to accept new socket.id in sockets array.
				(function acceptSocket(socket, sockets) {
					var userFound = false;
					if (sockets) {
						for (var i = 0; i < sockets.length; i++) {
							if (sockets[i] == socket.id) {
								userFound = true;
							}
						}
					}
					if (!userFound) {
						sockets.push(socket.id);
					}
					io.emit('updateConnected', sockets.length);
				})(socket, sockets);
				socket.on('disconnect', function () {
					sockets.forEach(function (socketId) {
						if (socketId == socket.id) {
							sockets.pop(socketId);
							io.sockets.emit('updateConnected', sockets.length);
						}
					});
				});
			});

			var privateKey, certificate, https, https_io;

			if (scope.config.ssl.enabled) {
				privateKey = fs.readFileSync(scope.config.ssl.options.key);
				certificate = fs.readFileSync(scope.config.ssl.options.cert);

				https = require('https').createServer({
					key: privateKey,
					cert: certificate,
					ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:' + 'ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:' + '!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA'
				}, app);

				https_io = require('socket.io')(https);
			}

			cb(null, {
				express: express,
				app: app,
				server: server,
				io: io,
				https: https,
				https_io: https_io
			});
		}],

		dbSequence: ['logger', function (scope, cb) {
			var sequence = new Sequence({
				onWarning: function (current, limit) {
					scope.logger.warn('DB queue', current);
				}
			});
			cb(null, sequence);
		}],

		sequence: ['logger', function (scope, cb) {
			var sequence = new Sequence({
				onWarning: function (current, limit) {
					scope.logger.warn('Main queue', current);
				}
			});
			cb(null, sequence);
		}],

		balancesSequence: ['logger', function (scope, cb) {
			var sequence = new Sequence({
				onWarning: function (current, limit) {
					scope.logger.warn('Balance queue', current);
				}
			});
			cb(null, sequence);
		}],

		/**
		 * Once config, public, genesisblock, logger, build and network are completed,
		 * adds configuration to `network.app`.
		 * @method connect
		 * @param {object} scope - The results from current execution, 
		 * at leats will contain the required elements.
		 * @param {function} cb - Callback function.
		 */
		connect: ['config', 'public', 'genesisblock', 'logger', 'build', 'network', 'cache', function (scope, cb) {
			var path = require('path');
			var bodyParser = require('body-parser');
			var cookieParser = require('cookie-parser');
			var methodOverride = require('method-override');
			var queryParser = require('express-query-int');
			var randomString = require('randomstring');
			var session = require('express-session');
			var RedisStore = require('connect-redis')(session);

			scope.nonce = randomString.generate(16);
			scope.network.app.engine('html', require('ejs').renderFile);
			scope.network.app.use(require('express-domain-middleware'));
			scope.network.app.set('view engine', 'ejs');
			scope.network.app.set('views', path.join(__dirname, 'public'));
			scope.network.app.use(scope.network.express.static(path.join(__dirname, 'public')));
			scope.network.app.use(bodyParser.raw({ limit: '2mb' }));
			scope.network.app.use(bodyParser.urlencoded({ extended: true, limit: '2mb', parameterLimit: 5000 }));
			scope.network.app.use(bodyParser.json({ limit: '2mb' }));
			scope.network.app.use(methodOverride());
			scope.network.app.use(cookieParser());

			//hotam: configured redis for session handling
			var options = {
				host: scope.cache.client.connection_options.host,
				port: scope.cache.client.connection_options.port,
				client: scope.cache.client
			};
			scope.network.app.use(session({
				key: 'ETP.sess',
				store: new RedisStore(options),
				secret: scope.config.session.secret,
				resave: true,
				saveUninitialized: false,
				cookie: {
					path: '/',
					httpOnly: true,
					secure: false,
					maxAge: 5 * 60 * 1000,
					signed: false
				}
			}));

			//hotam: middleware to add session.id and address of the logged-in user into the logs
			scope.network.app.use(function (req, res, next) {
				if (req.session.address) {
					logman = new Logger(req.session.id, req.session.address);
					logger = logman.logger;
				} else {
					logman = new Logger();
					logger = logman.logger;
				}
				next();
			});

			var ignore = ['id', 'name', 'lastBlockId', 'blockId', 'transactionId', 'address', 'recipientId', 'senderId', 'previousBlock'];

			scope.network.app.use(queryParser({
				parser: function (value, radix, name) {
					if (ignore.indexOf(name) >= 0) {
						return value;
					}

					// Ignore conditional fields for transactions list
					if (/^.+?:(blockId|recipientId|senderId)$/.test(name)) {
						return value;
					}

					/*eslint-disable eqeqeq */
					if (isNaN(value) || parseInt(value) != value || isNaN(parseInt(value, radix))) {
						return value;
					}
					/*eslint-enable eqeqeq */
					return parseInt(value);
				}
			}));

			scope.network.app.use(require('./helpers/z_schema-express.js')(scope.schema));

			scope.network.app.use(httpApi.middleware.logClientConnections.bind(null, scope.logger));

			/* Instruct browser to deny display of <frame>, <iframe> regardless of origin.
			 *
			 * RFC -> https://tools.ietf.org/html/rfc7034
			 */
			scope.network.app.use(httpApi.middleware.attachResponseHeader.bind(null, 'X-Frame-Options', 'DENY'));
			/* Set Content-Security-Policy headers.
			 *
			 * frame-ancestors - Defines valid sources for <frame>, <iframe>, <object>, <embed> or <applet>.
			 *
			 * W3C Candidate Recommendation -> https://www.w3.org/TR/CSP/
			 */
			scope.network.app.use(httpApi.middleware.attachResponseHeader.bind(null, 'Content-Security-Policy', 'frame-ancestors \'none\''));

			scope.network.app.use(httpApi.middleware.applyAPIAccessRules.bind(null, scope.config));

			cb();
		}],

		ed: function (cb) {
			cb(null, require('./helpers/ed.js'));
		},

		bus: ['ed', function (scope, cb) {
			var changeCase = require('change-case');
			var bus = function () {
				this.message = function () {
					var args = [];
					Array.prototype.push.apply(args, arguments);
					var topic = args.shift();
					var eventName = 'on' + changeCase.pascalCase(topic);

					// executes the each module onBind function
					modules.forEach(function (module) {
						if (typeof (module[eventName]) === 'function') {
							module[eventName].apply(module[eventName], args);
						}
						if (module.submodules) {
							async.each(module.submodules, function (submodule) {
								if (submodule && typeof (submodule[eventName]) === 'function') {
									submodule[eventName].apply(submodule[eventName], args);
								}
							});
						}
					});
				};
			};
			cb(null, new bus());
		}],
		db: function (cb) {
			var db = require('./helpers/database.js');
			db.connect(config.db, logger, cb);

		},
		/**
		 * It tries to connect with redis server based on config. provided in config.json file
		 * @param {function} cb
		 */
		cache: function (cb) {
			var cache = require('./helpers/cache.js');
			cache.connect(config.cacheEnabled, config.cache, logger, cb);
		},
		/**
		 * Once db, bus, schema and genesisblock are completed,
		 * loads transaction, block, account and peers from logic folder.
		 * @method logic
		 * @param {object} scope - The results from current execution, 
		 * at leats will contain the required elements.
		 * @param {function} cb - Callback function.
		 */
		logic: ['db', 'bus', 'schema', 'genesisblock', function (scope, cb) {
			var Transaction = require('./logic/transaction.js');
			var Block = require('./logic/block.js');
			var Account = require('./logic/account.js');
			var Peers = require('./logic/peers.js');
			var Frozen = require('./logic/frozen.js');
			var Contract = require('./logic/contract.js');
			var SendFreezeOrder = require('./logic/sendFreezeOrder.js');

			async.auto({
				bus: function (cb) {
					cb(null, scope.bus);
				},
				db: function (cb) {
					cb(null, scope.db);
				},
				ed: function (cb) {
					cb(null, scope.ed);
				},
				logger: function (cb) {
					cb(null, logger);
				},
				schema: function (cb) {
					cb(null, scope.schema);
				},
				genesisblock: function (cb) {
					cb(null, {
						block: genesisblock
					});
				},
				network: function (cb) {
					cb(null, scope.network);
				},
				config: function (cb) {
					cb(null, scope.config);
				},
				account: ['db', 'bus', 'ed', 'schema', 'genesisblock', 'logger', function (scope, cb) {
					new Account(scope.db, scope.schema, scope.logger, cb);
				}],
				transaction: ['db', 'bus', 'ed', 'schema', 'genesisblock', 'account', 'logger', 'config', 'network', function (scope, cb) {
					new Transaction(scope.db, scope.ed, scope.schema, scope.genesisblock, scope.account, scope.logger, scope.config, scope.network, cb);
				}],
				block: ['db', 'bus', 'ed', 'schema', 'genesisblock', 'account', 'transaction', function (scope, cb) {
					new Block(scope.ed, scope.schema, scope.transaction, cb);
				}],
				peers: ['logger', function (scope, cb) {
					new Peers(scope.logger, cb);
				}],
				frozen: ['logger', 'db', 'transaction', 'network', 'config', function (scope, cb) {
					new Frozen(scope.logger, scope.db, scope.transaction, scope.network, scope.config, cb);
				}],
				sendFreezeOrder: ['logger', 'db', 'network', function (scope, cb) {
					new SendFreezeOrder(scope.logger, scope.db, scope.network, cb);
				}],
				contract: ['config', function (scope, cb) {
					new Contract(scope.config, cb);
				}]
			}, cb);
		}],
		/**
		 * Once network, connect, config, logger, bus, sequence,
		 * dbSequence, balancesSequence, db and logic are completed,
		 * loads modules from `modules` folder using `config.modules`.
		 * @method modules
		 * @param {object} scope - The results from current execution,
		 * at leats will contain the required elements.
		 * @param {nodeStyleCallback} cb - Callback function with resulted load.
		 */
		modules: ['network', 'connect', 'config', 'logger', 'bus', 'sequence', 'dbSequence', 'balancesSequence', 'db', 'logic', 'cache', function (scope, cb) {

			var tasks = {};

			Object.keys(config.modules).forEach(function (name) {
				tasks[name] = function (cb) {
					var d = require('domain').create();

					d.on('error', function (err) {
						scope.logger.error('Domain ' + name, { message: err.message, stack: err.stack });
					});

					d.run(function () {
						logger.debug('Loading module', name);
						var Klass = require(config.modules[name]);
						var obj = new Klass(cb, scope);
						modules.push(obj);
					});
				};
			});

			async.parallel(tasks, function (err, results) {
				cb(err, results);
			});
		}],

		/**
		 * Loads api from `api` folder using `config.api`, once modules, logger and
		 * network are completed.
		 * @method api
		 * @param {object} scope - The results from current execution, 
		 * at leats will contain the required elements.
		 * @param {function} cb - Callback function.
		 */
		api: ['modules', 'logger', 'network', function (scope, cb) {
			Object.keys(config.api).forEach(function (moduleName) {
				Object.keys(config.api[moduleName]).forEach(function (protocol) {
					var apiEndpointPath = config.api[moduleName][protocol];
					try {
						var ApiEndpoint = require(apiEndpointPath);
						new ApiEndpoint(scope.modules[moduleName], scope.network.app, scope.logger, scope.modules.cache);
					} catch (e) {
						scope.logger.error('Unable to load API endpoint for ' + moduleName + ' of ' + protocol, e);
					}
				});
			});

			scope.network.app.use(httpApi.middleware.errorLogger.bind(null, scope.logger));
			cb();
		}],

		ready: ['modules', 'bus', 'logic', function (scope, cb) {
			scope.bus.message('bind', scope.modules);
			scope.logic.transaction.bindModules(scope.modules);
			scope.logic.peers.bindModules(scope.modules);
			cb();
		}],

		/**
		 * Once 'ready' is completed, binds and listens for connections on the
		 * specified host and port for `scope.network.server`.
		 * @method listen
		 * @param {object} scope - The results from current execution, 
		 * at leats will contain the required elements.
		 * @param {nodeStyleCallback} cb - Callback function with `scope.network`.
		 */
		listen: ['ready', function (scope, cb) {
			scope.network.server.listen(scope.config.app.port, scope.config.address, function (err) {
				scope.logger.info('ETP started: ' + scope.config.address + ':' + scope.config.app.port);

				if (!err) {
					if (scope.config.ssl.enabled) {
						scope.network.https.listen(scope.config.ssl.options.port, scope.config.ssl.options.address, function (err) {
							scope.logger.info('ETP https started: ' + scope.config.ssl.options.address + ':' + scope.config.ssl.options.port);

							cb(err, scope.network);
						});
					} else {
						cb(null, scope.network);
					}
				} else {
					cb(err, scope.network);
				}
			});
		}]
	}, function (err, scope) {
		if (err) {
			logger.error(err);
		} else {
			//Hotam Singh
			// cron job to save data on elasticsearch
			cron.schedule('* * * * *', function () {
				var dbTables = [
					'blocks',
					'dapps',
					'delegates',
					'mem_accounts',
					'migrations',
					'rounds_fees',
					'trs',
					'votes',
					'signatures',
					'stake_orders',
					'peers',
					'peers_dapp',
					'intransfer',
					'outtransfer',
					'multisignatures'
				];
				dbTables.forEach(function (tableName) {
					scope.db.query('SELECT * FROM ' + tableName)
					.then(function (rows) {
						if (rows.length > 0) {
							var bulk = utils.makeBulk(rows, tableName);
							utils.indexall(bulk, tableName)
							.then(function (result) {
								//Handle further operation in case of successfull indexing if needed
							})
							.catch(function (err) {
								console.log('elasticsearch error : ', err);
							});
						}
					})
					.catch(function (err) {
						console.log('database error : ', err);
					});
				});
			});

			// cron jon to check freezed order
			cron.schedule('* * * * *', function () {
				var date = new Date();

				//Navin : daily check and update stake_orders, if any Active order expired or not
				scope.logic.frozen.checkFrozeOrders(); //For testing purpose only
				if (date.getHours() === 10 && date.getMinutes() === 20) { // Check the time

					scope.logic.frozen.checkFrozeOrders();
				}

				//hotam: archive log files on first day of every new month
				var nextDate = new Date();
				nextDate.setDate(nextDate.getDate() + 1);
				//FIXME: set isArchived variable to redis. currently it is set on application level
				scope.modules.cache.isExists('isArchived', function (err, isExist) {
					if (!isExist) {
						scope.modules.cache.setJsonForKey('isArchived', false);
					}
					scope.modules.cache.getJsonForKey('isArchived', function (err, isArchived) {
						if (date.getDate() === 1 && !isArchived) {
							scope.modules.cache.setJsonForKey('isArchived', true);
							logger.archive('start executing archiving files');
							var createZip = require('./create-zip');
							var year = date.getFullYear();
							var month = date.toLocaleString("en-us", { month: "long" });
							var dir = path.join(__dirname + '/archive/' + year + '/' + month);
							createZip.createDir(dir, function (err) {
								if (!err) {
									createZip.archiveLogFiles(dir, function (err) {
										if (!err) {
											logger.archive('files are archived');
										} else {
											logger.archive('archive error : ' + err);
										}
									});
								} else {
									logger.archive('directory creation error : ' + err);
								}
							});
						}
					});
				});
			});

			/**
			 * Handles app instance (acts as global variable, passed as parameter).
			 * @global
			 * @typedef {Object} scope
			 * @property {Object} api - Undefined.
			 * @property {undefined} balancesSequence - Sequence function, sequence Array.
			 * @property {string} build - Empty.
			 * @property {Object} bus - Message function, bus constructor.
			 * @property {Object} config - Configuration.
			 * @property {undefined} connect - Undefined.
			 * @property {Object} db - Database constructor, database functions.
			 * @property {function} dbSequence - Database function.
			 * @property {Object} ed - Crypto functions from ETP node-sodium.
			 * @property {Object} genesisblock - Block information.
			 * @property {string} lastCommit - Hash transaction.
			 * @property {Object} listen - Network information.
			 * @property {Object} logger - Log functions.
			 * @property {Object} logic - several logic functions and objects.
			 * @property {Object} modules - Several modules functions.
			 * @property {Object} network - Several network functions.
			 * @property {string} nonce
			 * @property {string} public - Path to ETP public folder.
			 * @property {undefined} ready
			 * @property {Object} schema - ZSchema with objects.
			 * @property {Object} sequence - Sequence function, sequence Array.
			 * @todo logic repeats: bus, ed, genesisblock, logger, schema.
			 * @todo description for nonce and ready
			 */
			scope.logger.info('Modules ready and launched');
			/**
			 * Event reporting a cleanup.
			 * @event cleanup
			 */
			/**
			 * Receives a 'cleanup' signal and cleans all modules.
			 * @listens cleanup
			 */
			process.once('cleanup', function () {

				scope.logger.info('Cleaning up...');
				async.eachSeries(modules, function (module, cb) {
					if (typeof (module.cleanup) === 'function') {
						module.cleanup(cb);
					} else {
						setImmediate(cb);
					}
				}, function (err) {
					if (err) {
						scope.logger.error(err);
					} else {
						scope.logger.info('Cleaned up successfully');
					}
					process.exit(1);
				});
			});

			/**
			 * Event reporting a SIGTERM.
			 * @event SIGTERM
			 */
			/**
			 * Receives a 'SIGTERM' signal and emits a cleanup.
			 * @listens SIGTERM
			 */
			process.once('SIGTERM', function () {
				/**
				 * emits cleanup once 'SIGTERM'.
				 * @emits cleanup
				 */
				process.emit('cleanup');
			});

			/**
			 * Event reporting an exit.
			 * @event exit
			 */
			/**
			 * Receives an 'exit' signal and emits a cleanup.
			 * @listens exit
			 */
			process.once('exit', function () {
				/**
				 * emits cleanup once 'exit'.
				 * @emits cleanup
				 */
				process.emit('cleanup');
			});

			/**
			 * Event reporting a SIGINT.
			 * @event SIGINT
			 */
			/**
			 * Receives a 'SIGINT' signal and emits a cleanup.
			 * @listens SIGINT
			 */
			process.once('SIGINT', function () {
				/**
				 * emits cleanup once 'SIGINT'.
				 * @emits cleanup
				 */
				process.emit('cleanup');
			});
		}
	});
});

/**
 * Event reporting an uncaughtException.
 * @event uncaughtException
 */
/**
 * Receives a 'uncaughtException' signal and emits a cleanup.
 * @listens uncaughtException
 */
process.on('uncaughtException', function (err) {
	// Handle error safely
	logger.error('System error', { message: err.message, stack: err.stack });
	/**
	 * emits cleanup once 'uncaughtException'.
	 * @emits cleanup
	 */
	process.emit('cleanup');
});
