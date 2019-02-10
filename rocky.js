// this is ROCKY
const express = require('express')
const WebSocket = require('ws')
const bittrex = require('node-bittrex-api')
const sha512 = require('js-sha512')
const crypto = require('crypto')
const Poloniex = require('poloniex-api-node')
const isHexdigest = require('is-hexdigest')
const waitUntil = require('wait-until');
const app = express()
const port = 3000

const expressWs = require('express-ws')(app)

require('dotenv').config()

// ----- TMP ------
let max_points = 3    // the length of the realtime log arrays (speed?)
let pong_thresh = 1   // The number of consecutive positive conversions (used to trigger a triangle)
let wait_limit = 100 // how many cycles it'll wait for an order to fill.
let max_trades = 1    // 
let triangle_q = 0
let portfolio = {  }
let histLog = {  }
// let portfolio = { XMR: 0.999, DOGE: 19992, XRP: 101.447, ETC: 2, BAT: 52 }

const polo_channels = require('./exch_info/polo_channels.json');
const polo_tri_obj = require('./exch_info/polo_tri_obj.json');
const polo_api_key = process.env.POLO_KEY
const polo_api_secret = process.env.POLO_SECRET
const polo_fee_maker = 0.1 // %!
const polo_fee_taker = 0.2 // %!

const btrx_markets = require('./exch_info/btrx_markets.json');
const btrx_api_key = process.env.BTRX_KEY
const btrx_api_secret = process.env.BTRX_SECRET
const btrx_fee = 0.25 // %!

polo_ws_url = 'wss://api2.poloniex.com'            // wss://api2.poloniex.com
btrx_ws_url = 'https://socket.bittrex.com/signalr' // https://socket.bittrex.com/signalr

// WS for tracking triangles
const polo_ws = new WebSocket(polo_ws_url, { perMessageDeflate: false });

// WS for account notifications (must test + track)  // https://www.npmjs.com/package/poloniex-api-node
const poloniex = new Poloniex(polo_api_key, polo_api_secret, { socketTimeout: 130000 });

// CONNECTED EXCHANGES
let exchanges = [ 'poloniex' ]   // , 'bittrex' 

// TEST TRIANGLES (these should be determined by bullwinkle)
let triangles = [ 
                // [ 'polo BAT BTC', 'polo BTC USDT', 'polo USDT BAT' ]
                //  [ 'polo XMR USDT', 'polo USDT NXT', 'polo NXT XMR' ],    //   XMR - USDT - NXT
                //  [ 'polo ETH STEEM', 'polo STEEM BTC', 'polo BTC ETH' ],  //   ETH - STEEM - BTC
                //  [ 'polo ETH LSK', 'polo LSK USDT', 'polo USDT ETH' ],    //   ETH - LSK - USDT
                 //[ 'polo XMR BTC', 'polo BTC NXT', 'polo NXT XMR' ],      //   XMR - BTC - NXT
                 //[ 'polo XMR BTC', 'polo BTC BCN', 'polo BCN XMR' ]      //   XMR - BTC - BCN
                 //[ 'polo XMR BCN', 'polo BCN BTC', 'polo BTC XMR' ],      //   XMR - BCN - BTC
                 //[ 'polo ETH LSK', 'polo LSK BTC', 'polo USDT ETH' ]
                 [ 'polo DOGE USDC', 'polo USDC USDT', 'polo USDT DOGE' ],
                 [ 'polo DOGE USDT', 'polo USDT USDC', 'polo USDC DOGE' ]
                //  [ 'polo ETH SNT', 'polo SNT USDT', 'polo USDT ETH']

                ]

// from mass list
// triangles = polo_tri_obj['DOGE']
// console.log(triangles)

// Unique pairs (which exchange?)
const sub_set = [ ...new Set([].concat.apply([], triangles)) ]

// Setup realtime log object
let log = { polo: {}, btrx: {} }
for(let ang = 0; ang <= sub_set.length - 1; ang++) {
    let angle = sub_set[ang].split(' '), exch = angle[0], one = angle[1], two = angle[2]
    log[exch][`${one}_${two}`] = [ 'null' ]
    log[exch][`${two}_${one}`] = [ 'null' ]
}

// Setup triangle history object
let tri_hist = { }
for(let tri = 0; tri <= triangles.length - 1; tri++) {
    let angle = sub_set[tri].split(' '), exch = angle[0], one = angle[1], two = angle[2]
    tri_hist[tri] = { 
        'path' : triangles[tri].join(' '),
        'last_prix': 0,
        'consecutive': 0
    }
}

// Setup Order Book Object
let order_book = { polo: { ask: { }, bid: { } }, btrx: { ask: { }, bid: { } } }
let trade_wall = { A: false, B: false, C: false }
let ask_hist = { }
let bid_hist = { }

// FUNCTION -> Update Realtime Log
updateLog = (exch, pair, prix) => {
    if(prix !== undefined) {
        if(log[exch][pair] === [ 'null' ]) {
            log[exch][pair] = prix
        } else {
            if(log[exch][pair].length === max_points) {
                log[exch][pair].shift()
            }
            // TODO: these need to be split by 
            log[exch][pair].push(prix[0]) //log[exch][pair] = log[exch][pair].push(prix[0])
        }
    }
    for(let t = 0; t <= triangles.length - 1; t++) {
        checkTri(t)
    }
}

// FUNCTION -> Convert Currency 'angle'
converter = (exch, amnt, curr_a, curr_b) => {
    // console.log('converting', amnt, curr_a, 'for', curr_b, 'on', exch)

    let frwd = `${curr_a}_${curr_b}`, back = `${curr_b}_${curr_a}`,
        rates = log[exch][frwd][0] === 'null' ? log[exch][back] : log[exch][frwd],
        direction = log[exch][frwd][0] === 'null' ? 'back' : 'frwd'

    if(rates[0] === [ 'null' ]) {
        return 0
    } else {
        let latest = rates[0]
        let fee = (polo_fee_taker / 100) * amnt
        if(direction === 'frwd') {
            return (amnt - fee) / latest
        } else {
            return (amnt - fee) * latest
        }
    }
}

// FUNCTION -> Check For Triangular Arbitrage Opportunity
checkTri = (x) => {

    if(histLog.triangle === undefined) {    // meaning there's no triangle in action
        // console.log('no triangle in action')
        let tri = triangles[x]
        let a = tri[0], b = tri[1], c = tri[2]

        //        exchange               currency 1             currency 2
        let a_e = a.split(' ')[0], a_1 = a.split(' ')[1], a_2 = a.split(' ')[2] // angle A |  Base to A  $
        let b_e = b.split(' ')[0], b_1 = b.split(' ')[1], b_2 = b.split(' ')[2] // angle B |  A to B     $$ 
        let c_e = c.split(' ')[0], c_1 = c.split(' ')[1], c_2 = c.split(' ')[2] // angle C |  B to Base  $$$

        let start_bal = portfolio[a_e] !== undefined ? portfolio[a_e][a_1] : 1

        if(a_1 === 'BAT') {
            start_bal = 1.1
        } else if (a_1 === 'DOGE') {
            start_bal = 600
        } else if (a_1 === 'USDC') {
            start_bal = 0.02
        } else if (a_1 === 'XMR') {
            start_bal = 0.001
        } else if (a_1 === 'ETC') {
            start_bal = 0.1
        } else if (a_1 === 'ETH') {
            start_bal = 0.01
        }
        // generate lowest possible ask for this triangle to complete.
        // fibbonacci snowball function here?

        // Minimum Triangle Asks
        let a_ask = ask_hist[`${a_1}_${a_2}`] === undefined ? ask_hist[`${a_2}_${a_1}`] : ask_hist[`${a_1}_${a_2}`]
        let b_ask = ask_hist[`${b_1}_${b_2}`] === undefined ? ask_hist[`${b_2}_${b_1}`] : ask_hist[`${b_1}_${b_2}`]
        let c_ask = ask_hist[`${c_1}_${c_2}`] === undefined ? ask_hist[`${c_2}_${c_1}`] : ask_hist[`${c_1}_${c_2}`]
        // Maximum Triangle Bids
        let a_bid = bid_hist[`${a_1}_${a_2}`] === undefined ? bid_hist[`${a_2}_${a_1}`] : bid_hist[`${a_1}_${a_2}`]
        let b_bid = bid_hist[`${b_1}_${b_2}`] === undefined ? bid_hist[`${b_2}_${b_1}`] : bid_hist[`${b_1}_${b_2}`]
        let c_bid = bid_hist[`${c_1}_${c_2}`] === undefined ? bid_hist[`${c_2}_${c_1}`] : bid_hist[`${c_1}_${c_2}`]

        // console.log(' ----------------- ')
        // console.log(a_1, '-', b_1, '-', c_1)
        // console.log('----- Min ASK')
        // console.log(a_ask, b_ask, c_ask)
        // console.log('----- Max BID')
        // console.log(a_bid, b_bid, c_bid)
        // console.log('----- BALANCES')

    ///////// ANGLE A
        let a_out = converter(a_e, start_bal, a_1, a_2)      // Expected Profit
        let a_back = converter(a_e, 1, a_2, a_1)             // Reverse Conversion
        let a_frwd = converter(c_e, 1, a_1, a_2)             // Backward Conversion
        let a_dir = log['polo'][`${a_1}_${a_2}`][0] === 'null' ? 'frwd' : 'back'
        let a_tradable = true
        let a_min_spend = 0

        // console.log('-- ', a_e, a_1, a_2, ' --') 
        // console.log('trade 1: youd have ', a_out, a_2)
        // console.log('trade 1: from ' + start_bal + ' ' + a_1)

        if(portfolio[a_e] !== undefined) {
            if(a_dir === 'frwd') {
                a_min_spend = a_back * a_ask
                if((portfolio[a_e][a_1] / (a_back * a_ask)) <= 2 && a_bid === undefined && a_ask === undefined) {
                    a_tradable = false
                }
                // console.log('balance -----: ' + portfolio[a_e][a_1] + ' ' + a_1)
                // console.log('a_min_spend -: ' + a_min_spend + ' ' + a_1)
                // console.log('-> enough ---: ' + Math.round(portfolio[a_e][a_1] / (a_back * a_ask)) + ' trades')
                // console.log("-> Min spend of " + a_ask + ' ' + a_2)
                // console.log("-> Min spend of " + a_back * a_ask + ' ' + a_1)
            } else {
                a_min_spend = a_ask
                if((start_bal / (a_ask)) <= 2 && a_bid === undefined && a_ask === undefined) { // JayZ's Mother?
                    a_tradable = false   // Don't buy anything unless you can afford 2 of them
                }
                // console.log('balance -----: ' + portfolio[a_e][a_2] + ' ' + a_2)
                // console.log('a_min_spend -: ' + a_min_spend + ' ' + a_2)
                // console.log('<- enough ---: ' + Math.round(start_bal / a_ask) + ' trades')
                // console.log("<- Min spend of " + a_frwd * a_ask + ' ' + a_2)
                // console.log("<- Min spend of " + a_ask + ' ' + a_1)
            }
        }

    ///////// ANGLE B
        let b_out = converter(b_e, a_out, b_1, b_2) 
        let b_back = converter(b_e, 1, b_2, b_1)     // Reverse Conversion
        let b_frwd = converter(b_e, 1, b_1, b_2)
        let b_dir = log['polo'][`${b_1}_${b_2}`][0] === 'null' ? 'frwd' : 'back' 
        let b_tradable = true
        let b_min_spend = 0

        // console.log('-- ', b_e, b_1, b_2, ' --') 
        // console.log('trade 2: youd have ', b_out, b_2)
        // console.log('trade 2: from ' + a_out + ' ' + b_1)

        if(portfolio[b_e] !== undefined) {
            if(b_dir === 'frwd') {
                if(((a_out + portfolio[b_e][b_1]) / (b_back * b_ask)) <= 1 && b_bid === undefined && b_ask === undefined) {
                    b_tradable = false
                }
                b_min_spend = b_back * b_ask
                // console.log('balance -----: ' + a_out + portfolio[b_e][b_1] + ' ' + b_1)
                // console.log('b_min_spend -: ' + b_min_spend + ' ' + b_1)
                // console.log("-> Min spend of " + b_ask + ' ' + b_2)
                // console.log("-> Min spend of " + b_back * b_ask + ' ' + b_1)
                // console.log("-> enough for: " + (a_out + portfolio[b_e][b_1]) / (b_back * b_ask) + ' trades')
            } else {
                if((a_out / (b_ask)) <= 1 && b_bid === undefined && b_ask === undefined) {
                    b_tradable = false
                }
                b_min_spend = b_ask
                // console.log("<- Min spend of " + b_frwd * b_ask + ' ' + b_2)
                // console.log("<- Min spend of " + b_ask + ' ' + b_2)
                // console.log("<- enough for: " + (a_out / (b_ask)) + ' trades')
            }
        }

    ///////// ANGLE C
        let c_out = converter(c_e, b_out, c_1, c_2)
        let c_back = converter(c_e, 1, c_2, c_1)     // Reverse Conversion
        let c_frwd = converter(c_e, 1, c_1, c_2)
        let c_dir = log['polo'][`${c_1}_${c_2}`][0] === 'null' ? 'frwd' : 'back'  
        let c_tradable = true 
        let c_min_spend = 0

        // console.log('-- ', c_e, c_1, c_2, ' --') 
        // console.log('trade 3: youd have ', c_out, c_2)
        // console.log('trade 3: from ' + b_out + ' ' + c_1)

        if(portfolio[c_e] !== undefined) {
            if(c_dir === 'frwd') {
                if(((b_out + portfolio[c_e][c_1]) / (c_back * c_ask)) <= 1 && c_bid === undefined && c_ask === undefined) {
                    c_tradable = false
                }
                c_min_spend = c_back * c_ask
                // console.log('balance -----: ' + b_out + portfolio[c_e][c_1] + ' ' + c_1)
                // console.log('c_min_spend -: ' + c_min_spend + ' ' + c_1)
                // console.log("-> Min spend of " + c_ask + ' ' + c_2)
                // console.log("-> Min spend of " + c_back * c_ask + ' ' + c_1)
                // console.log("-> enough for: " + (b_out + portfolio[c_e][c_1]) / (c_back * c_ask) + ' trades')
            } else {
                if((b_out / (c_ask)) <= 1 && c_bid === undefined && c_ask === undefined) {
                    c_tradable = false
                }
                c_min_spend = c_ask

                // console.log('balance -----: ' + (portfolio[c_e][c_1] + b_out) + ' ' + c_1)
                // console.log('a_min_spend -: ' + c_min_spend + ' ' + c_1)
                // console.log('<- enough ---: ' + (b_out / (c_ask)) + ' trades')
                // console.log("<- Min spend of " + c_frwd * c_ask + ' ' + c_2)
                // console.log("<- Min spend of " + c_ask + ' ' + c_1)
                // console.log("<- enough for: " + (b_out / (c_ask)) + ' trades')
            }
        }

        let profit = c_out - start_bal
        let margin = (profit / start_bal) * 100

        if(a_tradable && b_tradable && c_tradable && !isNaN(margin)) {
            console.log(' ----------------- ')
            console.log('[ ',a_1, '-', b_1, '-', c_1, ' ]  ', Math.round(margin), '%')

            if(margin >= 0 && margin <= 100) {  // this basically handles if the data gets fucked up
                tri_hist[x].consecutive = tri_hist[x].consecutive + 1
            } else {
                tri_hist[x].consecutive = 0
            }

            if(tri_hist[x].consecutive > pong_thresh) {

                if(max_trades > 0) { // if we're not out of trades in config.
        
                    // Where is the value coming from in this triangle? trade 1, 2 or 3?
                    console.log('== TRIANGULAR ARBITRAGE OPPORTUNITY SPOTTED! ==')
                    console.log(`Tri ${x} : ${a_1}-[0]->${b_1}-[0]->${c_1}-[0]->${a_1} : eP = ${margin.toFixed(3)}% : ${tri_hist[x].consecutive} consecutive positives`)
                    
                    max_trades = max_trades - 1  // i.e. if max_trades was set to 10 in config
                    triangle_q = triangle_q + 1  // idk
        
                    fireTriangle(tri, margin, start_bal) // CARPE!
        
                    
                } else {
                    console.log('no trades left')
                }
            } else {
                console.log('watching...')
            }
        } else {
            // console.log('not a triangle tradable :(')
            // minimum transaction error, low balance
        }


    } else {  // meaning there's a triangle in action
        // console.log('triangle in action')
        // check what triangle stage we're at?
        // console.log(histLog.triangle)
        triHandler()
    }
}

remove = (array, element) => {
    const index = array.indexOf(element);
    return array.splice(index, 1);
  }

triHandler = () => {
    console.log('TRIANGLE IN ACTION! ', histLog.triangle.path)

    if(Object.keys(histLog).length === 1) {
        // console.log('triangle only')
    } else if (Object.keys(histLog).length === 2) {

        console.log(Object.keys(histLog))
        // console.log(histLog)

        let keys = Object.keys(histLog)
        remove(keys, 'triangle');

        if(histLog.triangle.order_nums.indexOf(keys[0]) === -1) {
            console.log('order number isn\'t in histlog')
            histLog.triangle.order_nums.push(keys[0])

        } else if (histLog.triangle.trade_B && histLog.triangle.current !== 'C') { // execute trade C
            console.log(`========= Angle 3 [ ${histLog.triangle.path[2]} ] ==========`)
            histLog.triangle.current = 'C'
            console.log('firing trade C')

        } else if (histLog.triangle.trade_A && histLog.triangle.current !== 'B') { // execute trade B

            console.log(`========= Angle 2 [ ${histLog.triangle.path[1]} ] ==========`)
            histLog.triangle.current = 'B'
            console.log('firing trade B')
            console.log(histLog, log)
            let B = histLog.triangle.path[1].split(' ')
            let rate_2 = log[B[0]][`${B[1]}_${B[2]}`][0]
            let pair_2 = `${B[1]}_${B[2]}`
        
            if(log[B[0]][pair_2][0] === 'null') {
                rate_2 = log[B[0]][`${B[2]}_${B[1]}`][0]
                pair_2 = `${B[2]}_${B[1]}`
            }
            console.log(pair_2, rate_2)

            // fireTrade(A[0], pair_1, amount_1, rate_1, 'A')
            fireTrade(histLog.triangle.path[1].split(' ')[0], 
                      pair_2, 
                      histLog.triangle.amount_B, 
                      rate_2,
                      'B')
            // fireTrade(exch, pair, amount, rate, angle)
            
        } else {                              // initial call from fireTriange()
            // console.log('order number is in histlog!')
            if(histLog[keys[0]].complete === 0) {
                console.log('order incomplete!, waiting to fill')

                console.log('order rate is: ' + histLog[keys[0]].order_rate)
                console.log('lowest ask is: ' + ask_hist[histLog[keys[0]].pair])
                console.log('highest bid is: ' + bid_hist[histLog[keys[0]].pair])

                // console.log(histLog[keys[0]].order_rate > ask_hist[histLog[keys[0]].pair])
                // console.log(histLog[keys[0]].order_rate > bid_hist[histLog[keys[0]].pair])

                if(histLog[keys[0]].order_rate > ask_hist[histLog[keys[0]].pair]) {
                    console.log('rate is higher than lowest ask') // people can get a better rate
                    console.log(1 - (ask_hist[histLog[keys[0]].pair] / histLog[keys[0]].order_rate))
                    histLog[keys[0]].elapsed += 1
                } else if (histLog[keys[0]].order_rate < bid_hist[histLog[keys[0]].pair]) {
                    console.log('rate is lower than highest bid') // people can get a better rate
                    console.log(1 - (bid_hist[histLog[keys[0]].pair] / histLog[keys[0]].order_rate))
                    histLog[keys[0]].elapsed += 1
                }

                console.log('Order Pending: ' + histLog[keys[0]].elapsed + ' cycles')
                if(histLog[keys[0]].elapsed === wait_limit) {
                    console.log('wait limit reached, cancelling order and resetting')
                    // resetTriangle() // maybe 'look for another opportunity' function later
                }
                
            } else {
                console.log('ORDER A COMPLETE!')
            }
        }

    } else if (Object.keys(histLog).length === 3) {
        console.log('working on ANGLE B')


    } else if (Object.keys(histLog).length === 4) {
        console.log('working on ANGLE C')
    }
    // ========= Angle 2,3 [ polo DOGE USDC ] ==========
    // Object.keys(histLog).forEach((key, i) => {
    //     console.log(i, key)
    // })

}

// Update portfolio object
portUpdate = (exch, curr, op, amnt) => {
    console.log(">>> OLD " + curr + " bal " + portfolio[exch][curr])
    let current_bal = portfolio[exch][curr]
    let new_bal = op === '-' ? current_bal - Number(amnt) : current_bal + Number(amnt)
    console.log(">>> NEW " + curr + " bal " + new_bal)
    portfolio[exch][curr] = new_bal
}

histUpdate = (data) => {  // upon receiving: newLimitOrder, newTrade, orderUpdate
    console.log('histUpdate called')

    if(data.type === 'systemOrder') {

        // there's no order_id yet
        console.log('adding system order to histLog')
        // console.log(data)

        histLog[`triangle`] = {
            xP: data.xP,
            complete: false,
            current: 'A',
            path: data.triangle,
            amount_A: data.amount,
            amount_B: 0,
            amount_C: 0,
            time_init: data.time,
            time_added: Math.round((new Date()).getTime() / 1000),
            order_nums: [],
            A: data.A, B: data.B, C: data.C,
            time_A: '', time_B: '', time_C: '',
            trade_A: false, trade_B: false, trade_C: false
        }
        // console.log('histLog: ', histLog)

    } else if(data.type === 'newLimitOrder') {       // Create Key : { values } for order
        console.log('NEW ORD UPDATE - ', data)

        console.log('pair - ' + data.pair)

        histLog[`_${data.order_id}`] = { 
            complete: 0,                  // 1 if complete else 0
            elapsed: 0,
            time_init: '',
            pair: data.pair,
            order_id: data.order_id,
            order_rate: data.order_rate,
            order_amnt: data.order_amnt,
            order_type: data.order_type,
            order_time: data.order_time,  // from 'newLimitOrder' response from exchange.
            trades: [ ],
            update: [ ]
        }

    } else if (data.type === 'newTrade') {
        console.log('NEW TRADE UPDATE - ', data)

        console.log(data.order_id)

        if(histLog.hasOwnProperty(`_${data.order_id}`) === -1) {
            // console.log('order id NOT present')
        } else {
            // console.log('order id IS present') // wha?

            if(histLog[`_${data.order_id}`] === undefined) {
                console.log(histLog[`_${data.order_id}`], 'order IS NOT present!')

                // still need time here

                let complete = 0,
                    pair = ''

                if(data.trade_amnt === histLog.triangle.amount_A) {
                    console.log('FULL COMPLETION OF TRADE A!')
                    complete = 1
                    histLog.triangle.trade_A = true
                    pair = histLog.triangle.path[0]
                } else if (data.trade_amnt === histLog.triangle.amount_B) {
                    console.log('FULL COMPLETION OF TRADE B!')
                    complete = 1
                    histLog.triangle.trade_B = true
                    pair = histLog.triangle.path[1]
                } else if (data.trade_amnt === histLog.triangle.amount_C) {
                    console.log('FULL COMPLETION OF TRADE C!')
                    complete = 1
                    histLog.triangle.trade_C = true
                    pair = histLog.triangle.path[2]
                } else {
                    console.log('Partial completion??')
                }

                histLog[`_${data.order_id}`] = {
                        complete: complete,       // 1 if complete else 0
                        elapsed: 0,
                        time_init: '',
                        pair: pair,
                        order_id: data.order_id,
                        order_rate: data.trade_rate,
                        order_amnt: data.trade_amnt,
                        trades: [ data ],
                        update: [ ]
                }

                console.log(histLog)
            } else {
                console.log('order is present!')
                // histLog[`_${data.order_id}`].trades = histLog[`_${data.order_id}`].trades.push(data)
            }
            // console.log(data)
        }

    // `_${data.order_id}`
    // histUpdate({ type : 'newTrade',
    //     order_id: trade_order_num,
    //     trade_id: trade_id,
    //     trade_rate: trade_rate,
    //     trade_amnt: trade_amnt,
    //     trade_fee: trade_fee_mult
    //   })

    } else if (data.type === 'orderUpdate') {
        console.log("UPDATE - order update")
        // console.log(data)
    }
}
// FUNCTION -> FIRE TRADE
fireTrade = (exch, pair, amount, rate, angle) => {
    console.log("---------      EXECUTING TRADE!      ---------")      
    let owned = pair.split('_')[1]
    let to = pair.split('_')[0]
    let angle_pairs = histLog.triangle.path

    if(angle === 'A') {
        owned = angle_pairs[0].split(' ')[1]
        to = angle_pairs[0].split(' ')[2]
    } else if(angle === 'B') {
        owned = angle_pairs[1].split(' ')[1]
        to = angle_pairs[1].split(' ')[2]
    } else if(angle === 'C') {
        owned = angle_pairs[2].split(' ')[1]
        to = angle_pairs[2].split(' ')[2]
    }

    let dir = log[exch][`${owned}_${to}`][0] === 'null' ? 'frwd' : 'back'

    console.log(histLog.triangle.path)
    console.log('Angle: ' + angle)
    console.log('Exchange: ' + exch)
    console.log('Direction: ' + dir)
    console.log("Official Pair: " + pair)
    console.log("Amount To Trade: " + amount + ' ' + owned)
    console.log('Time Since Execution: ' )
    console.log('Rate: ', rate)

    let s_adj = 0.9,
        b_adj = 1.1

    if(dir === 'frwd') {
        console.log('Rate: ' + rate + ' ' + to + ' per ' + owned + ' in market: ' + pair)
        console.log("SELL!", pair, rate * s_adj, amount)
        poloniex.sell(pair, rate, amount)
    } else {
        console.log('Rate: ' + rate + ' ' + owned + ' per ' + to + ' in market: ' + pair)
        console.log("BUY!!", pair, rate * b_adj, amount)
        poloniex.buy(pair, rate, amount)
    }

    // poloniex.buy(pair, rate, amount) // ETH_BAT buys 1 BAT
    // poloniex.sell(pair, rate, amount) // ETH_BAT sells 1 BAT
    // poloniex.xxx(pair, rate, amount, fillOrKill, immediateOrCancel, postOnly [, callback])

    console.log('TRADE SENT!')
}

fireTriangle = (tri, xP, amount_1) => {  // triangle and expected profit margin
    console.log(`========= FIRING TRIANGLE ==========`)

    let tri_init = Math.round((new Date()).getTime() / 1000); // used to track 'time since opportunity was found'
    let A = tri[0].split(' '), B = tri[1].split(' '), C = tri[2].split(' ')

    if(portfolio[A[0]][A[1]] === undefined) { return '' }

    let base_bal = portfolio[A[0]][A[1]]

    console.log("BASE COIN: " + A[1])
    console.log("BASE BAL: " + base_bal)
    console.log('TRIANGLE: ', tri)
    console.log('INIT TIME: ', tri_init)
    console.log('EXPECTED PROFIT: ' + Math.round(xP, 3) + '%')
    console.log('MINIMUM SPEND: ')

    histUpdate({ 
        type: 'systemOrder',
        time: tri_init,
        triangle: tri,
        amount: amount_1,
        xP: xP,
        A: A[1], B: B[1], C: C[1]
    })

    console.log(`========= Angle 1 [ ${tri[0]} ] ==========`)

    let rate_1 = log[A[0]][`${A[1]}_${A[2]}`][0]
    let pair_1 = `${A[1]}_${A[2]}`

    if(log[A[0]][pair_1][0] === 'null') {
        rate_1 = log[A[0]][`${A[2]}_${A[1]}`][0]
        pair_1 = `${A[2]}_${A[1]}`
    }

    fireTrade(A[0], pair_1, amount_1, rate_1, 'A')

    // The rest are handled by the triHandler() function
    // basically switches from monitor mode to 


    // console.log(`=========   TRIANGLE RESULTS   ==========`)
    // console.log(amount_1 + ' ' + A[1] + ' is now ' + 'xxx')
    // console.log("Elapsed Time: ")
    // console.log('Expected Profit: ' + Math.round(xP))
    // console.log('Actual Profit')

    // triangle_q = triangle_q - 1  // Remove this triangle from the queue

    // console.log('Resuming Trading... ')

}

resetTriangle = () => {
    console.log('RESET !')
}

// ================
// === POLONIEX ===
// ================

// Account Monitor
poloniex.on('message', (channelName, data, seq) => {
    // console.log(data)
    if(data === 'subscriptionSucceeded') {
        console.log("POLO_1 account notifications succeeded")
    } else { 
        if(channelName === 'ticker') {
            ask_hist[data.currencyPair] = Number(data.lowestAsk)
            bid_hist[data.currencyPair] = Number(data.highestBid)
            // console.log('ticker', ask_hist, bid_hist)
        } else {
        // handle if NewTrade isnt first or not present 
        // for(let n = 0; n < data.length; n++) {
        //     if(data[n].type === 'newLimitOrder') {
        //     }
        // }
            console.log("=== " + channelName + " ===")
            for(let n = 0; n < data.length; n++) {
                let message = data[n]
                let messageType = message.type
                // console.log("message part - " + message) console.log("message type - " +  messageType)
                if(messageType === 'newLimitOrder') {
                    console.log("> MSG - New Limit Order")
                    let pair = message.data.currencyPair
                    let new_order_num = message.data.orderNumber
                    let order_type = message.data.type
                    let order_rate = Number(message.data.rate)
                    let order_amnt = Number(message.data.amount)
                    let order_time = message.data.date
                    //console.log(pair, new_order_num, trade_type, trade_rate, trade_amnt, trade_time)
                    histUpdate({ type: 'newLimitOrder',
                                 pair: pair,
                                 order_id: new_order_num,
                                 order_type: order_type,
                                 order_rate: order_rate,
                                 order_amnt: order_amnt,
                                 order_time: order_time
                                })
                } else if (messageType === 'balanceUpdate') {
                    console.log("> MSG - Balance Update")
                    // console.log(message.data)

                    let update_curr = message.data.currency
                    let update_walt = message.data.wallet
                    let update_amnt = message.data.amount.charAt(0) === '-' ? message.data.amount.slice(1) : message.data.amount
                    let operator = message.data.amount.charAt(0) === '-' ? '-' : '+'
                    
                    // console.log(update_curr, update_walt, operator, Number(update_amnt))
                    // console.log(histLog.triangle)

                    if(update_curr === histLog.triangle.A) {
                        console.log('>>> balance update for coin A')

                        if(!histLog.triangle.trade_B) { // Trade B is not done yet
                            console.log((update_amnt / histLog.triangle.amount) * 100, '% coin A removed')
                        } else {
                            console.log('!!!!!!!!!! FINAL STEP COMPLETE !!!!!!!!!!')
                            // confirm that the C->A order has been filled
                        }
                        
                    } else if(update_curr === histLog.triangle.B) {
                        console.log('>>> balance update for coin B')

                        if(operator === '+') {
                            console.log('incoming')
                            // console.log(update_amnt)
                            histLog.triangle.amount_B = Number(update_amnt)
                        } else {
                            console.log('outgoing')
                        }
                        // histLog.triangle.amount_B = 
                        // confirm that the A->B order has been filled
                    } else if(update_curr === histLog.triangle.C) {
                        console.log('>>> balance update for coin C')
                        // confirm that the B->C order has been filled
                    }

                    portUpdate('polo', update_curr, operator, Number(update_amnt))

                } else if (messageType === 'orderUpdate') {  
                    console.log("> MSG - Order Update")
                    let up_order_num = message.data.orderNumber
                    let up_amount = Number(message.data.amount)
                    histUpdate({ type : 'orderUpdate',
                                 order_id: trade_order_num,
                                 up_amnt: up_amount
                               })
                } else if (messageType === 'newTrade') {  
                    console.log("> MSG - New Trade")
                    let trade_id = message.data.tradeID
                    let trade_rate = Number(message.data.rate)
                    let trade_amnt = Number(message.data.amount)
                    let trade_fee_mult = Number(message.data.feeMultiplier)
                    let trade_funding_type = message.data.fundingType
                    let trade_order_num = message.data.orderNumber
                    // console.log(trade_id, trade_rate, trade_amount, trade_fee_mult, trade_funding_type, trade_order_num)
                    histUpdate({ type : 'newTrade',
                                 order_id: trade_order_num,
                                 trade_id: trade_id,
                                 trade_rate: trade_rate,
                                 trade_amnt: trade_amnt,
                                 trade_fee: trade_fee_mult
                               })
                } else {
                    console.log(message)
                }
    
            // === Types ===
            // newLimitOrder
                // Actual order placed, amount immediately taken from account at date
                    // { currencyPair: 'USDC_XRP',
                    //   orderNumber: 8902336992,
                    //   type: 'sell',
                    //   rate: '0.31690507',
                    //   amount: '101.44749229',
                    //   date: '2019-01-22 22:02:23' }
                    
            // balanceUpdate
                // { currency: 'USDC', wallet: 'exchange', amount: '0.14167076' }
            
            // orderUpdate
                // { orderNumber: 8902336992, amount: '0.44749229' }
    
            // newTrade
                // { tradeID: 35531,
                //   rate: '0.31690507',
                //   amount: '101.00000000',
                //   feeMultiplier: '0.00100000',
                //   fundingType: 0,
                //   orderNumber: 8902336992 }
            }

        }

    
    }
});
 
poloniex.on('open', () => {
  console.log(`POLO_1 connected`);
  poloniex.subscribe(1000);  
  poloniex.subscribe('ticker');                 // account notification channel (beta)
  poloniex.returnBalances().then((blncs) => {   // account balance 
    console.log("POLO_1 account balances acquired")

    Object.keys(blncs).forEach((curr, i) => {
        blncs[curr] = Number(blncs[curr])
    })

    portfolio['polo'] = blncs

  }).catch((err) => {
    console.log(err.message);
  });
});
 
poloniex.on('close', (reason, details) => {
  console.log(`Poloniex WebSocket connection disconnected`);
});
 
poloniex.on('error', (error) => {
  console.log(`POLO_1 : An error has occured`, error);

});
 
poloniex.openWebSocket();

// VANILLA PRICE FEED WEBSOCKET
polo_ws.on('open', function open() {
    console.log('POLO_0 connected')

    // Subscribe to triangle channels
    for(let sub = 0; sub <= sub_set.length - 1; sub++) {
        let angle = sub_set[sub].split(' '), exch = angle[0], one = angle[1], two = angle[2]
        if(exch === 'polo'){
            let chan = polo_channels[0][`${one}_${two}`]
            if(chan === undefined) {
                chan = polo_channels[0][`${two}_${one}`]
            }
            polo_ws.send(JSON.stringify({
                "command": "subscribe",
                "channel": chan
                }))
        } 
    }
})

polo_ws.onerror = error => {
    console.log(`POLO_0 disconnected`, error)
    }

polo_ws.onmessage = e => {
    let msg = JSON.parse(e.data)
    let msg_body = msg[2]
    let pair = polo_channels[0][msg[0]]

    if(msg.length > 1 && msg_body !== undefined) {

        // console.log("===== " + pair + " =====")

        let prix = [ ]    // this takes in the live order book
        let o_asks = [ ] 
        let o_bids = [ ]

        for(let c = 0; c < msg_body.length; c++) {
            if(msg_body[c][0] === 'i') {
                // console.log('> initial dump')

                let max_length = 30
                let ask_book = msg_body[c][1].orderBook[0]
                let bid_book = msg_body[c][1].orderBook[1]

                let askArr = Object.keys(ask_book).map(Number).slice(0, max_length)
                let bidArr = Object.keys(bid_book).map(Number).slice(0, max_length)

                if(Object.keys(order_book.polo.ask).indexOf(pair) === -1) {
                    order_book.polo.ask[pair] = { }
                    order_book.polo.bid[pair] = { }
                }
                
                for(let r = 0; r <= max_length - 1; r++) {
                    // console.log(askArr[r].toFixed(8))
                    // console.log(ask_book[askArr[r].toFixed(8)])
                    order_book.polo.ask[pair][askArr[r].toFixed(8)] = Number(ask_book[askArr[r].toFixed(8)])
                    // console.log(bidArr[r].toFixed(8))
                    // console.log(bid_book[bidArr[r].toFixed(8)])
                    order_book.polo.bid[pair][bidArr[r].toFixed(8)] = Number(bid_book[bidArr[r].toFixed(8)])
                    // { <ask/bid> : <amount> }
                }
                // console.log(order_book)
            } else if (msg_body[c][0] === 'o') {
                // console.log('> book update')

                if(Number(msg_body[c][3]) === 0) {
                    // console.log('> removal', pair, msg_body[c][2])

                    if(order_book.polo.ask[pair][msg_body[c][2]] !== undefined && order_book.polo.bid[pair][msg_body[c][2]] !== undefined) {
                        order_book.polo.ask[pair][msg_body[c][2]] = 0
                        order_book.polo.bid[pair][msg_body[c][2]] = 0
                    } else if (order_book.polo.bid[pair][msg_body[c][2]] === undefined) {
                        order_book.polo.ask[pair][msg_body[c][2]] = 0
                    } else if (order_book.polo.ask[pair][msg_body[c][2]] === undefined) {
                        order_book.polo.bid[pair][msg_body[c][2]] = 0
                    }

                } else {

                    if(msg_body[c][1] === 0) {
                        // console.log('>> price change SELL (someone wants to sell [ask])')
                        // console.log(order_book.polo.ask[pair][msg_body[c][2]])
                        // console.log(order_book.polo.bid[pair][msg_body[c][2]])
                        // console.log(ask_hist[pair] + ' - current min ask')
                        // console.log(Number(msg_body[c][2]) + ' - this ask')
                        // console.log(Number(msg_body[c][2]) < ask_hist[pair])

                        if(ask_hist[pair] === undefined) {
                            ask_hist[pair] = Number(msg_body[c][2])
                        } else if (Number(msg_body[c][2]) < ask_hist[pair]) {
                            ask_hist[pair] = Number(msg_body[c][2])
                        }

                        order_book.polo.ask[pair][msg_body[c][2]] = Number(msg_body[c][3])

                    } else {
                        // console.log('>> price change BUY (someone wants to buy [bid])')
                        // console.log(order_book.polo.ask[pair][msg_body[c][2]])
                        // console.log(order_book.polo.bid[pair][msg_body[c][2]])
                        // console.log(bid_hist[pair] + ' - current max bid')
                        // console.log(Number(msg_body[c][2]) + ' - this bid')
                        // console.log(Number(msg_body[c][2]) > bid_hist[pair])

                        if(bid_hist[pair] === undefined) {
                            bid_hist[pair] = Number(msg_body[c][2])
                        } else if (Number(msg_body[c][2]) > bid_hist[pair]) {
                            bid_hist[pair] = Number(msg_body[c][2])
                        }

                        order_book.polo.bid[pair][msg_body[c][2]] = Number(msg_body[c][3])
                    }
                    // console.log(msg_body[c])
                    prix.push(msg_body[c][2])
                    // console.log(order_book)
                    // console.log(order_book.polo.ask)
                }

            } else if (msg_body[c][0] === 't') {
                console.log('> trade update')
                // prix.push(msg_body[c][2]) 
            } else {
                console.log("> ERROR?")
            }
        }
        // console.log(log)
        updateLog('polo', pair, prix)
    }
}

// ===============
// === BITTREX ===
// ===============
if(exchanges.includes('bittrex')) {
    bittrex.options({
        'verbose' : false,
        'cleartext' : true,
        'baseUrl' : btrx_ws_url,  // 'https://bittrex.com/api/v1.1',
        websockets: {
          onConnect: function() {
            console.log('BTRX_0 connected');
            for(var sub = 0; sub <= sub_set.length - 1; sub++) {
                let angle = sub_set[sub].split(' '), exch = angle[0], one = angle[1], two = angle[2]
                if(exch === 'btrx'){
                    let pair = btrx_markets.includes(`${one}-${two}`) ? `${one}-${two}` : `${two}-${one}`
                    bittrex.websockets.subscribe([pair], function(data) {
                        if(data.M === 'updateExchangeState') {
                            let tmp_prix = 0
                            let pair = data.A[0].MarketName.split('-').join('_')
                            if(data.A[0].Buys.length > 0 && data.A[0].Sells.length > 0) {
                                tmp_prix = (data.A[0].Buys[0].Rate + data.A[0].Sells[0].Rate) / 2
                            } else if (data.A[0].Buys.length === 0 && data.A[0].Sells.length === 0) {
                                tmp_prix = 0
                            } else if (data.A[0].Buys.length > 0) {
                                tmp_prix = data.A[0].Buys[0].Rate
                            } else {
                                tmp_prix = data.A[0].Sells[0].Rate
                            }
                            updateLog('btrx', pair, tmp_prix)
                        }
                    });
                } 
            }
          },
          onDisconnect: function() {
            console.log('BTRX disconnected');
          }
        }
      });
       
      var websocketClient;
      bittrex.websockets.client(function(client) {
        websocketClient = client;
      });
}
//////////////////////////////////////
app.listen(port, () => console.log(`ROCKY Running On Port: ${port}!`))