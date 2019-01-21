// this is ROCKY
const express = require('express')

const WebSocket = require('ws');

const bittrex = require('node-bittrex-api');
 
const app = express()
const port = 3000

//app.get('/', (req, res) => res.send('Hello World!'))

const expressWs = require('express-ws')(app);

const polo_channels = require('./exch_info/polo_channels.json');

polo_ws_url = 'wss://api2.poloniex.com'            // wss://api2.poloniex.com
btrx_ws_url = 'https://socket.bittrex.com/signalr' // https://socket.bittrex.com/signalr

// CONNECTED EXCHANGES
let exchanges = [ 'poloniex' ]  // , 'bittrex'

// TEST TRIANGLE
let triangles = [ [ 'polo BTC ZRX', 'polo ZRX ETH', 'polo ETH BTC' ],
                  [ 'polo BTC XMR', 'polo XMR LTC', 'polo LTC BTC' ] 
                ]

// Unique pairs (which exchange?)
let sub_set = [ ...new Set([].concat.apply([], triangles)) ]

const polo_ws = new WebSocket(polo_ws_url, { perMessageDeflate: false });

let log = { polo: {}, btrx: {} }

for(var ang = 0; ang <= sub_set.length - 1; ang++) {
    let angle = sub_set[ang].split(' '), exch = angle[0], one = angle[1], two = angle[2]
    log[exch][`${one}_${two}`] = [ 'null' ]
    log[exch][`${two}_${one}`] = [ 'null' ]
}

let funny_money = 1
let max_points = 3

updateLog = (exch, pair, prix) => {
    //console.log('LOG UPDATE')
    if(prix !== undefined) {
        //console.log(exch, pair, prix)
        if(log[exch][pair] === [ 'null' ]) {
            log[exch][pair] = [ prix ]
        } else {
            if(log[exch][pair].length === max_points) {
                log[exch][pair].shift()
            }
            log[exch][pair].push(prix)
        }
    }
    for(var t = 0; t <= triangles.length - 1; t++) {
        checkTri(t)
    }
    
}

converter = (exch, amnt, curr_a, curr_b) => {
    //console.log('======= CONVERTING =========')
    //console.log('converting', amnt, curr_a, 'for', curr_b, 'on', exch)

    let frwd = `${curr_a}_${curr_b}`
    let back = `${curr_b}_${curr_a}`
    let rates = log[exch][frwd][0] === 'null' ? log[exch][back] : log[exch][frwd]
    let direction = undefined

    if(log[exch][frwd][0] === 'null') {
        direction = 'back'
    } else {
        direction = 'frwd'
    }
    if(rates[0] === [ 'null' ]) {
        return 0
    } else {
        let latest = rates[0]
        if(direction === 'frwd') {
            return amnt / latest
        } else {
            return amnt * latest
        }
    }

}

checkTri = (x) => {

    let tri = triangles[x]
    let start_bal = funny_money // 1 BTC
    let a = tri[0], b = tri[1], c = tri[2]
    
    //        exchange               currency 1             currency 2
    let a_e = a.split(' ')[0], a_1 = a.split(' ')[1], a_2 = a.split(' ')[2] // angle A
    let b_e = b.split(' ')[0], b_1 = b.split(' ')[1], b_2 = b.split(' ')[2] // angle B
    let c_e = c.split(' ')[0], c_1 = c.split(' ')[1], c_2 = c.split(' ')[2] // angle C

    //console.log('================ CHECKING TRIANGLE ', x)
    //console.log(a, '->', b, '->', c)

    // console.log(a_e, a_1, a_2)
    var a_out = converter(a_e, start_bal, a_1, a_2)
    //console.log('trade 1: youd have ', a_out, a_2)

    // console.log(b_e, b_1, b_2)
    var b_out = converter(b_e, a_out, b_1, b_2)
    //console.log('trade 2: youd have ', b_out, b_2)

    //console.log(c_e, c_1, c_2)
    var c_out = converter(c_e, b_out, c_1, c_2)
    //console.log('step 3: youd have ', c_out, c_2)

    var profit = c_out - funny_money
    var margin = (profit / funny_money) * 100

    console.log(`Triangle ${x} : ${a_1} -> ${b_1} -> ${c_1} : Profit = ${margin.toFixed(3)}%`)
}

// ================
// === POLONIEX ===
// ================
polo_ws.on('open', function open() {
    console.log('POLO connected')

    for(var sub = 0; sub <= sub_set.length - 1; sub++) {
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
    console.log(`POLO disconnected`, error)
    }

polo_ws.onmessage = e => {
    //console.log('polo pong')
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
        websockets: {
          onConnect: function() {
            console.log('BTRX connected');
            bittrex.websockets.subscribe(['BTC-ETH'], function(data) {
                console.log('btrx pong')
                //console.log(data.M)
            });
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


app.listen(port, () => console.log(`Example app listening on port ${port}!`))