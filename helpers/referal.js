'use strict';

var mailServices = require('./nodemailer');
var rewards = require('./rewards');
var async = require('async');
var sql = require('../sql/referal_sql');
var env = process.env;

var library = {};

exports.Referals = function(scope) {
    library = scope;
}

module.exports.api = function(app) {

    app.post('/referral/generateReferalLink', function(req, res) {

        var user_address = req.body.secret;
        var encoded = new Buffer(user_address).toString('base64');
        // var decoded = new Buffer(encoded, 'base64').toString('ascii');

        library.db.none(sql.updateReferLink, {
            referralLink: encoded,
            address: user_address
        }).then(function() {
            return res.status(200).json({
                success: true,
                referralLink: encoded
            });
        }).catch(function(err) {
            console.log(err);
            return res.status(400).json({
                success: false,
                err: err.detail
            });
        });

    });

    app.post('/referral/sendEmail', function(req, res) {

        var link = req.body.referlink;
        var mailOptions = {
            from: library.config.mailFrom, // sender address
            to: req.body.email, //req.body.email list of receivers, fix this before commit
            subject: 'Referral Link', // Subject line
            text: '', // plmodule.exportsain text body
            html: 'Hello, ' + req.body.email + ' <br><br>\
            <br> Please click on the Referral link below to register.<br><br>\
            <a href="' + link + '">Click here to confirm</a>'
        };

        mailServices.sendMail(mailOptions, library.config, function(err) {
            if (err) {
                return res.status(400).json({
                    success: false,
                    error: err
                });
            }
            return res.status(200).json({
                success: true,
                info: 'Mail sent successfully'
            });
        });
    });

    app.post('/referral/stakeReward', function(req, res) {

        var amount = req.body.amount;
        var sponsor_address = req.body.address;
        var overrideReward = {},
            i = 0;

        library.db.one(sql.referLevelChain, {
            address: sponsor_address
        }).then(function(user) {

            if (user.level != null && user.level[0] != "0") {

                overrideReward[user.level[i]] = ((100000000 * (env.STAKE_REWARD) * amount) / 100);

                library.db.one(sql.checkBalance, {
                    sender_address: env.SENDER_ADDRESS
                }).then(function(bal) {

                    if (parseInt(bal.u_balance) > 0) {

                        var transactionData = {
                            json: {
                                secret: env.SENDER_SECRET,
                                amount: overrideReward[user.level[i]],
                                recipientId: user.level[i],
                                transactionRefer: 11
                            }
                        };

                        library.logic.transaction.sendTransaction(transactionData, function(err, transactionResponse) {
                            if (err) return err;
                            console.log(transactionResponse.body);
                            if (transactionResponse.body.success == false)
                                return res.status(400).json({
                                    success: false,
                                    message: "Allocation is not sufficient No reward"
                                });
                            else
                                return res.status(200).json({
                                    success: true,
                                    message: "Reward awarded successfully"
                                });
                        });

                    } else {
                        return res.status(400).json({
                            success: false,
                            message: "Allocation is empty No reward"
                        });
                    }

                }).catch(function(err) {
                    return res.status(400).json({
                        success: false,
                        err: err.message
                    });
                });
            } else {
                return res.status(400).json({
                    success: false,
                    message: "No Introducer Found"
                });
            }

        }).catch(function(err) {
            return res.status(400).json({
                success: false,
                err: err.message
            });
        });

    });

    app.post('/referral/overridingReward', function(req, res) {

        var sponsor_address = req.body.sponser;
        var amount = req.body.amount;
        var overrideReward = {};
        var i = 0;

        library.db.one(sql.referLevelChain, {
            address: sponsor_address
        }).then(function(user) {

            if (user.level != null && user.level[0] != "0") {

                async.eachSeries(user.level, function(level, callback) {

                    // if (i < 15) {
                        overrideReward[level] = (((100000000 * rewards.level[i]) * amount) / 100);

                        library.db.one(sql.checkBalance, {
                            sender_address: env.SENDER_ADDRESS
                        }).then(function(bal) {

                            if (parseInt(bal.u_balance) > 0 && parseInt(bal.u_balance) >= overrideReward[level]) {

                                var transactionData = {
                                    json: {
                                        secret: env.SENDER_SECRET,
                                        amount: overrideReward[level],
                                        recipientId: level,
                                        transactionRefer: 11
                                    }
                                };

                                library.logic.transaction.sendTransaction(transactionData, function(err, transactionResponse) {
                                    if (err) return err;
                                    console.log(transactionResponse.body);
                                });
                            } else {
                                console.log(i);
                                var chain_length = user.level.length;
                                if (parseInt(bal.u_balance) == 0 || i == chain_length) {
                                    return res.status(400).json({
                                        success: false,
                                        balance: parseInt(bal.u_balance)/100000000,
                                        message: "Allocation is empty No reward"
                                    });
                                }
                            }
                            callback();

                        }).catch(function(err) {
                            return res.status(400).json({
                                success: false,
                                err: err.message,
                                reward: 0
                            });
                        });
                        i++;
                    // } else {
                    //     callback();
                    // }
                }, function(err) {
                    if (err) {
                        return res.status(400).json({
                            success: false,
                            err: err
                        });
                    }
                    return res.status(200).json({
                        success: true,
                        message: "Reward awarded successfully"
                    });
                });

            } else {
                return res.status(400).json({
                    success: false,
                    message: "No Introducer Found"
                });
            }

        }).catch(function(err) {
            return res.status(400).json({
                success: false,
                err: err.message,
                overrideReward: 0
            });
        });

    });

}