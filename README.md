# Rocky & Bullwinke Trading Bot!

GOAL: A CLI trading bot that watches the market weights multiple opportunities and makes trades that maximize, running persistantly from a raspberry pi.

## Strategy Implementation Features (levers)

    * Confidence Threshold (0.8)

    * Base Currency (and mix, like keep 75% BTC)

    * How Far Back (1 yr, 10 days, many tests?)

    * Trading Frequency Goal (1-hr frequency buy and sells)

## What You'll Need
* Raspberry Pi
* Poloniex Account
* CryptoCompare Account
* An email account so you can get notifications
* Python


### NOTES
* start script?
* config file?
* Import Relevant Data, deposits, withdrawals, trades.
* many exchanges?
* all currencies?
* 3rd party data?
* first things first? decide when to retrain? estimate trading time?
* predict how long training will take?
* remember training logs from previous runs, in csv.
* second, minute, hour, day timeframes?
* timeseries modelling for sure.
* get confidence interval and esitmated profit from strategy
* Trade feed, on a localhost server via raspberry pi?
* Use past data to predict market close or future value, 

* what if the bot goes for a 1-2 hour buy-sell goal but if it misses it switches to arbitrage?
* what if the arbitrage functionality was just a function, (find_a_way_to_make_base_money('eth'))

* what if it just compares arbitrage to buying and holding for one hour.

* Fees! do it programmatically somehow from APIs

* Keep a log of how long it will take for the order to go through.
* going to need to separate the operational functions from the actual algorithm.


