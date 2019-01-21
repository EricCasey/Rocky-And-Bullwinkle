# https://github.com/s4w3d0ff/python-poloniex

import numpy as np
import pandas as pd
import os
import poloniex

polo = poloniex.Poloniex('W1A2LCS4-X9PE8RQU-V1DETQA5-GAJ0ZLKM', '8c2dcb073e85967fb026111629f2a1b75e7341b6706080b7b16a2c2b02787bc0cb52d9d953b54c0dc25114868c3d527bc6742418d61845f54b3c3e7471abd6db')
polo.key = 'W1A2LCS4-X9PE8RQU-V1DETQA5-GAJ0ZLKM'
polo.secret = '8c2dcb073e85967fb026111629f2a1b75e7341b6706080b7b16a2c2b02787bc0cb52d9d953b54c0dc25114868c3d527bc6742418d61845f54b3c3e7471abd6db'

exchange_list = ['Poloniex']

balances = polo('returnBalances')

coinList = list(balances.keys())

holdList = [coin for coin, amnt in balances.items() if float(amnt) > 0.00000001]

print(balances)
print(holdList)

# is the goal coin the right proportion? yes? proceed, no? decide?
print("Your Goal Coin Makes Up " + str(0) + "% Of Your Portfolio.")


# print(coinList)


# print(polo.returnTicker()['BTC_ETH'])

