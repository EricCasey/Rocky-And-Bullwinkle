// this is ROCKY
const express = require('express')
const WebSocket = require('ws');
const bittrex = require('node-bittrex-api');
const app = express()
const port = 3000

// app.get('/', (req, res) => res.send('Hello World!'))

const expressWs = require('express-ws')(app);

const polo_channels = require('./exch_info/polo_channels.json');
const polo_fee_maker = 0.2 // %!
const polo_fee_taker = 0.1 // %!

const btrx_markets = require('./exch_info/btrx_markets.json');

console.log(btrx_markets)

polo_ws_url = 'wss://api2.poloniex.com'            // wss://api2.poloniex.com
btrx_ws_url = 'https://socket.bittrex.com/signalr' // https://socket.bittrex.com/signalr

const polo_ws = new WebSocket(polo_ws_url, { perMessageDeflate: false });

// CONNECTED EXCHANGES
let exchanges = [ 'poloniex', 'bittrex' ]  

// TEST TRIANGLE
let triangles = [ 
                  [ 'polo BTC ZRX', 'polo ZRX ETH', 'polo ETH BTC' ],
                  [ 'polo BTC XMR', 'polo XMR LTC', 'polo LTC BTC' ],
                  [ 'btrx BTC TRX', 'btrx TRX ETH', 'btrx ETH BTC' ],
                  [ 'polo BTC XRP', 'btrx XRP ETH', 'btrx ETH BTC'],
                  [ 'polo BTC DOGE', 'polo DOGE USDC', 'polo USDC BTC' ]
                ]

// Unique pairs (which exchange?)
const sub_set = [ ...new Set([].concat.apply([], triangles)) ]

// Setup realtime log object
let log = { polo: {}, btrx: {} }
for(var ang = 0; ang <= sub_set.length - 1; ang++) {
    let angle = sub_set[ang].split(' '), exch = angle[0], one = angle[1], two = angle[2]
    log[exch][`${one}_${two}`] = [ 'null' ]
    log[exch][`${two}_${one}`] = [ 'null' ]
}

// Setup triangle history object
let tri_hist = { }
for(var tri = 0; tri <= triangles.length - 1; tri++) {
    let angle = sub_set[tri].split(' '), exch = angle[0], one = angle[1], two = angle[2]
    //console.log("Triangle " + tri)
    //console.log(triangles[tri])
    tri_hist[tri] = { 
        'path' : triangles[tri].join(' '),
        'last_prix': 0,
        'consecutive': 0 
    }
}

let funny_money = 1
let max_points = 3

updateLog = (exch, pair, prix) => {
    //console.log('LOG UPDATE')
    //console.log(exch, pair, prix)
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
    //console.log('converting', amnt, curr_a, 'for', curr_b, 'on', exch)

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
        var fee = (polo_fee_maker / 100) * amnt
        //console.log('fee of ', fee)
        if(direction === 'frwd') {
            // console.log('frwd rate ') // maker fee?
            return (amnt - fee) / latest
        } else {
            //console.log('back rate ') // taker fee?
            return (amnt - fee) * latest
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

    // console.log(a_e, a_1, a_2)
    var a_out = converter(a_e, start_bal, a_1, a_2)
    //console.log('trade 1: youd have ', a_out, a_2)

    // console.log(b_e, b_1, b_2)
    var b_out = converter(b_e, a_out, b_1, b_2)
    //console.log('trade 2: youd have ', b_out, b_2)

    //console.log(c_e, c_1, c_2)
    var c_out = converter(c_e, b_out, c_1, c_2)
    //console.log('trade 3: youd have ', c_out, c_2)

    var profit = c_out - funny_money
    var margin = (profit / funny_money) * 100
    //console.log(profit, margin)
    //console.log(tri_hist[x])

    if(margin >= 0) {
        tri_hist[x].consecutive = tri_hist[x].consecutive + 1
    } else {
        tri_hist[x].consecutive = 0
    }

    if(tri_hist[x].consecutive > 500) {
        console.log(`Triangle ${x} : ${a_1} -[0]-> ${b_1} -[0]-> ${c_1} : Profit = ${margin.toFixed(3)}% : ${tri_hist[x].consecutive}`)
    } else {
        //console.log('watching...')
    }
    

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
        'verbose' : true,
        'cleartext' : true,
        'baseUrl' : btrx_ws_url,  // 'https://bittrex.com/api/v1.1',
        websockets: {
          onConnect: function() {
            console.log('BTRX connected');
            for(var sub = 0; sub <= sub_set.length - 1; sub++) {
                let angle = sub_set[sub].split(' '), exch = angle[0], one = angle[1], two = angle[2]
                if(exch === 'btrx'){

                    let pair = btrx_markets.includes(`${one}-${two}`) ? `${one}-${two}` : `${two}-${one}`

                    bittrex.websockets.subscribe([pair], function(data) {
                        //console.log('btrx pong')
                        //console.log(data.M)
                        if(data.M === 'updateExchangeState') {
                            //console.log(data)
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

app.listen(port, () => console.log(`Example app listening on port ${port}!`))