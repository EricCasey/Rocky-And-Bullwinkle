// this is ROCKY
const express = require('express')
const WebSocket = require('ws')
const bittrex = require('node-bittrex-api')
const sha512 = require('js-sha512')
const crypto = require('crypto')
const Poloniex = require('poloniex-api-node')
const isHexdigest = require('is-hexdigest')
const app = express()
const port = 3000

const expressWs = require('express-ws')(app)

require('dotenv').config()

// ----- TMP ------
let funny_money = 1  
let max_points = 3   // the length of the realtime log arrays
let pong_thresh = 1 // Change this to time-based?
let max_trades = 1
let triangle_q = 0
let portfolio = {  }
let histLog = {  }
// let portfolio = { XMR: 0.999, DOGE: 19992, XRP: 101.447, ETC: 2, BAT: 52 }
// real live tradables = XRM, DOGE, XRP
// qualify tradeable coins by lowest ask.

const polo_channels = require('./exch_info/polo_channels.json');
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
                // [ 'polo BTC ZRX', 'polo ZRX ETH', 'polo ETH BTC' ],
                // [ 'polo BTC XMR', 'polo XMR LTC', 'polo LTC BTC' ],
                // [ 'btrx BTC TRX', 'btrx TRX ETH', 'btrx ETH BTC' ],
                // [ 'polo BTC XRP', 'btrx XRP ETH', 'btrx ETH BTC'],
                // [ 'polo BTC DOGE', 'polo DOGE USDC', 'polo USDC BTC' ],
                  [ 'polo USDC FOAM', 'polo FOAM BTC', 'polo BTC USDC' ],
                  [ 'polo XMR BTC', 'polo BTC ZEC', 'polo ZEC XMR' ],
                  [ 'polo DOGE ZEC', 'polo ZEC XMR', 'polo XMR DOGE' ],
                  [ 'polo BAT ETH', 'polo ETH USDT', 'polo USDT BAT' ]
                ]

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

// FUNCTION -> Update Realtime Log
updateLog = (exch, pair, prix) => {
    if(prix !== undefined) {
        if(log[exch][pair] === [ 'null' ]) {
            log[exch][pair] = [ prix ]
        } else {
            if(log[exch][pair].length === max_points) {
                log[exch][pair].shift()
            }
            log[exch][pair].push(prix)
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
        direction = undefined

    if(log[exch][frwd][0] === 'null') {
        direction = 'back'
    } else {
        direction = 'frwd'
    }
    if(rates[0] === [ 'null' ]) {
        return 0
    } else {
        let latest = rates[0]
        //console.log(direction, frwd, back)
        let fee = (polo_fee_taker / 100) * amnt
        //console.log('fee of ', fee)
        if(direction === 'frwd') {
            return (amnt - fee) / latest
        } else {
            return (amnt - fee) * latest
        }
    }
}

// FUNCTION -> Check For Triangular Arbitrage Opportunity
checkTri = (x) => {

    let tri = triangles[x]
    let a = tri[0], b = tri[1], c = tri[2]

    //        exchange               currency 1             currency 2
    let a_e = a.split(' ')[0], a_1 = a.split(' ')[1], a_2 = a.split(' ')[2] // angle A |  Base to A  $
    let b_e = b.split(' ')[0], b_1 = b.split(' ')[1], b_2 = b.split(' ')[2] // angle B |  A to B     $$ 
    let c_e = c.split(' ')[0], c_1 = c.split(' ')[1], c_2 = c.split(' ')[2] // angle C |  B to Base  $$$

    let start_bal = portfolio[a_e] !== undefined ? portfolio[a_e][a_1] : 1

    if(a_1 === 'BAT') {
        start_bal = 1
    } else if (a_1 === 'DOGE') {
        start_bal = 1000
    } else if (a_1 === 'USDC') {
        start_bal = 0.02
    } else if (a_1 === 'XMR') {
        start_bal = 0.001
    } else if (a_1 === 'ETC') {
        start_bal = 0.1
    }

    let a_out = converter(a_e, start_bal, a_1, a_2) // console.log(a_e, a_1, a_2) console.log('trade 1: youd have ', a_out, a_2)
    let b_out = converter(b_e, a_out, b_1, b_2)     // console.log(b_e, b_1, b_2) console.log('trade 2: youd have ', b_out, b_2)
    let c_out = converter(c_e, b_out, c_1, c_2)     // console.log(c_e, c_1, c_2) console.log('trade 3: youd have ', c_out, c_2)

    let profit = c_out - funny_money
    let margin = (profit / funny_money) * 100

    if(margin >= 0 && margin <= 100) { 
        tri_hist[x].consecutive = tri_hist[x].consecutive + 1
    } else {
        tri_hist[x].consecutive = 0
    }

    if(tri_hist[x].consecutive > pong_thresh) {
//triangle_q <
        if(max_trades > 0) {

            // Where is the value coming from in this triangle? trade 1, 2 or 3?
            console.log(`Tri ${x} : ${a_1}-[0]->${b_1}-[0]->${c_1}-[0]->${a_1} : eP = ${margin.toFixed(3)}% : ${tri_hist[x].consecutive}`)
            
            console.log("CHOICE!")

            max_trades = max_trades - 1
            triangle_q = trangle_q + 1

            fireTriangle(tri, c_out, start_bal) // EXECUTE!

        } else {
            // console.log('no trades left')
        }
        
    } else {
        // console.log('watching...')
    }
    
}

// Update portfolio object
portUpdate = (exch, curr, op, amnt) => {
    console.log('portUpdate called')
    //console.log(exch, curr, op, amnt)
    console.log("Old " + curr + " balance " + portfolio[exch][curr])

    let current_bal = portfolio[exch][curr]
    let new_bal = 0
    if(op === '-') {
        new_bal = current_bal - Number(amnt)
    } else if (op === '+') {
        new_bal = current_bal + Number(amnt)
    }
    console.log("New " + curr + " balance " + new_bal)

    portfolio[exch][curr] = new_bal

}

histUpdate = (data) => {  // upon receiving: newLimitOrder, newTrade, orderUpdate
    console.log('histUpdate called')

    //console.log(histLog)
    if(data.type === 'systemOrder') { 

        console.log('generate system order')

        // histLog
        // time_init: '',
        // there's no order_id yet

    } else if(data.type === 'newLimitOrder') {       // Create Key : { values } for order
        console.log('NEW ORD UPDATE - ', data)

        console.log('pair - ' + data.pair)
        console.log(histLog)

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

        console.log(histLog)

    } else if (data.type === 'newTrade') {
        console.log('NEW TRADE UPDATE - ', data)

        console.log(data.order_id)

        if(histLog.hasOwnProperty(`_${data.order_id}`)) {
            console.log('order id not present')
        } else {
            console.log('order id is present')
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
fireTrade = (exch, pair, amount, rate) => {
    console.log("--------- EXECUTING TRADE!!! ---------")          
    console.log(exch, pair, amount, rate)

    // xmr_btc = sell xmr for btc null
    // btc_zec = buy zec for btc  correct
    // zec_xmr = sell zec for xmr null

    // console.log(log)

    if(pair === 'ETH_BAT') {

        if(log[exch][pair] === [ 'null' ]) { // this means it's a SELL
            pair = `${pair.split('_')[1]}_${pair.split('_')[0]}`
        }

        console.log("official pair: " + pair)
        console.log("angle pair: " + "<angle pair>")

        // poloniex.buy(pair, rate, amount) // ETH_BAT buys 1 BAT
        // poloniex.sell(pair, rate, amount) // ETH_BAT sells 1 BAT

        // poloniex.xxx(pair, rate, amount, fillOrKill, immediateOrCancel, postOnly [, callback])
        
    }
    // if order is still being filled and opportunity disappears cancel it.
    // poloniex.cancelOrder(orderNumber [, callback])
}

fireTriangle = (tri, xP, amount_1) => {  // triangle and expected profit
    console.log(`========= FIRING TRIANGLE ==========`)

    let tri_init = Math.round((new Date()).getTime() / 1000); // used to track 'time since opportunity was found'
    let A = tri[0].split(' '), B = tri[1].split(' '), C = tri[2].split(' ')
    let base_bal = portfolio[A[0]][A[1]]
    console.log("base bal: " + base_bal)
    console.log(tri, tri_init, xP)

    histUpdate({ 
        type: 'systemOrder',
        time: tri_init,
        triangle: tri,
        amount: 0,
        order_num: 0
    })

    console.log(`========= Angle 1 [ ${tri[0]} ] ==========`)

    let rate_1 = log[A[0]][`${A[1]}_${A[2]}`][0]
    let pair_1 = `${A[1]}_${A[2]}`

    //console.log(log[A[0]][pair_1])

    if(log[A[0]][pair_1][0] === 'null') {
        console.log("TRIGGER")
        rate_1 = log[A[0]][`${A[2]}_${A[1]}`][0]
        pair_1 = `${A[2]}_${A[1]}`
    }

    fireTrade(A[0], pair_1, amount_1, rate_1)

    console.log(`========= Angle 2 [ ${tri[1]} ] ==========`)
    
    // wait for angle 1 to complete
    console.log("angle 2") // fireTrade(B.split(' ')[0], pair, amount)

    console.log(`========= Angle 3 [ ${tri[2]} ] ==========`)

    // wait for angle 2 to complete
    console.log("angle 3") // fireTrade(C.split(' ')[0], pair, amount)

    console.log(`=========   TRIANGLE RESULTS   ==========`)
    console.log(amount_1 + " is now " + 0)
    console.log("it took: <this long>")

    triangle_q = trangle_q - 1
}

// ================
// === POLONIEX ===
// ================

// Account Monitor
poloniex.on('message', (channelName, data, seq) => {

    if(data === 'subscriptionSucceeded') {
        console.log("POLO_1 account notifications succeeded")
    } else {

        console.log("=== " + channelName + " ===")
        //console.log(data)
        

        if(channelName === 'ticker') {
            //console.log(data)

            console.log(data.currencyPair + " lowest ask " + data.lowestAsk)

        } else {

        // handle if NewTrade isnt first or not present 
        // for(let n = 0; n < data.length; n++) {
        //     if(data[n].type === 'newLimitOrder') {
        //     }
        // }

            for(let n = 0; n < data.length; n++) {

                let message = data[n]
                let messageType = message.type
                
                // console.log("message part - " + message)
                // console.log("message type - " +  messageType)
    
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
    
                    let update_curr = message.data.currency
                    let update_walt = message.data.wallet
                    let update_amnt = update_amnt.charAt(0) === '-' ? message.data.amount.slice(1) : message.data.amount
                    let operator = update_amnt.charAt(0) === '-' ? '-' : '+'
    
                    //console.log(update_curr, update_walt, operator, Number(update_amnt))
    
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

// VANILLA "READING" WEBSOCKET
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
    let pair = polo_channels[0][msg[0]]
    if(msg.length > 1) {
        let prix = msg[2][0][2]
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