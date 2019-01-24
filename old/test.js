var arr = [ [ { type: 'newLimitOrder',
    data:
     { currencyPair: 'USDC_XRP',
       orderNumber: 8902336992,
       type: 'sell',
       rate: '0.31690507',
       amount: '101.44749229',
       date: '2019-01-22 22:02:23' } },
  { type: 'balanceUpdate',
    data:
     { currency: 'XRP', wallet: 'exchange', amount: '-101.44749229' } } ],
[ { type: 'orderUpdate',
    data: { orderNumber: 8902336992, amount: '0.44749229' } },
  { type: 'balanceUpdate',
    data:
     { currency: 'USDC', wallet: 'exchange', amount: '31.97540466'} },
  { type: 'newTrade',
    data:
     { tradeID: 35531,
       rate: '0.31690507',
       amount: '101.00000000',
       feeMultiplier: '0.00100000',
       fundingType: 0,
       orderNumber: 8902336992 } } ],

[ { type: 'orderUpdate',
    data: { orderNumber: 8902336992, amount: '0.00000000' } },
  { type: 'balanceUpdate',
    data:
     { currency: 'USDC', wallet: 'exchange', amount: '0.14167076' } },
  { type: 'newTrade',
    data:
     { tradeID: 35532,
       rate: '0.31690507',
       amount: '0.44749229',
       feeMultiplier: '0.00100000',
       fundingType: 0,
       orderNumber: 8902336992 } } ] ]


console.log(arr)

for(var i = 0; i <= arr.length - 1; i++) {
    
    var data = arr[i]
    console.log(data.length)

    for(var x = 0; x <= data.length - 1; x++) {
        var message = data[x]
        var messageType = message.type
        
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

        console.log("msg type - " + messageType)
        console.log(message.data)
    }


}