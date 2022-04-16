import EquixFactory from '@equixswap/equixswap-core/build/EquixFactory.json';
import EquixMigrator from '../../build/EquixMigrator.json';
import EquixRouter01 from '../../build/EquixRouter01.json';
import EquixRouter02 from '../../build/EquixRouter02.json';
import ERC20 from '../../build/ERC20.json';
import IEquixPair from '@equixswap/equixswap-core/build/IEquixPair.json';
import RouterEventEmitter from '../../build/RouterEventEmitter.json';
import UniswapV1Exchange from '../../build/UniswapV1Exchange.json';
import UniswapV1Factory from '../../build/UniswapV1Factory.json';
import WND29 from '../../build/WND29.json';
import { Contract, Wallet } from 'ethers';
import { deployContract } from 'ethereum-waffle';
import { expandTo18Decimals } from './utilities';
import { Web3Provider } from 'ethers/providers';

const overrides = {
  gasLimit: 9999999
}

interface V2Fixture {
  token0: Contract
  token1: Contract
  WND2: Contract
  WND2Partner: Contract
  factoryV1: Contract
  factoryV2: Contract
  router01: Contract
  router02: Contract
  routerEventEmitter: Contract
  router: Contract
  migrator: Contract
  WND2ExchangeV1: Contract
  pair: Contract
  WND2Pair: Contract
}

export async function v2Fixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<V2Fixture> {
  // deploy tokens
  const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const WND2 = await deployContract(wallet, WND29)
  const WND2Partner = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])

  // deploy V1
  const factoryV1 = await deployContract(wallet, UniswapV1Factory, [])
  await factoryV1.initializeFactory((await deployContract(wallet, UniswapV1Exchange, [])).address)

  // deploy V2
  const factoryV2 = await deployContract(wallet, EquixFactory, [wallet.address])

  // deploy routers
  const router01 = await deployContract(wallet, EquixRouter01, [factoryV2.address, WND2.address], overrides)
  const router02 = await deployContract(wallet, EquixRouter02, [factoryV2.address, WND2.address], overrides)

  // event emitter for testing
  const routerEventEmitter = await deployContract(wallet, RouterEventEmitter, [])

  // deploy migrator
  const migrator = await deployContract(wallet, EquixMigrator, [factoryV1.address, router01.address], overrides)

  // initialize V1
  await factoryV1.createExchange(WND2Partner.address, overrides)
  const WND2ExchangeV1Address = await factoryV1.getExchange(WND2Partner.address)
  const WND2ExchangeV1 = new Contract(WND2ExchangeV1Address, JSON.stringify(UniswapV1Exchange.abi), provider).connect(
    wallet
  )

  // initialize V2
  await factoryV2.createPair(tokenA.address, tokenB.address)
  const pairAddress = await factoryV2.getPair(tokenA.address, tokenB.address)
  const pair = new Contract(pairAddress, JSON.stringify(IEquixPair.abi), provider).connect(wallet)

  const token0Address = await pair.token0()
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA

  await factoryV2.createPair(WND2.address, WND2Partner.address)
  const WND2PairAddress = await factoryV2.getPair(WND2.address, WND2Partner.address)
  const WND2Pair = new Contract(WND2PairAddress, JSON.stringify(IEquixPair.abi), provider).connect(wallet)

  return {
    token0,
    token1,
    WND2,
    WND2Partner,
    factoryV1,
    factoryV2,
    router01,
    router02,
    router: router02, // the default router, 01 had a minor bug
    routerEventEmitter,
    migrator,
    WND2ExchangeV1,
    pair,
    WND2Pair
  }
}
