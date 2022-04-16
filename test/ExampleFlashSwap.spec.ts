import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { MaxUint256 } from 'ethers/constants'
import { BigNumber, bigNumberify, defaultAbiCoder, formatEther } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './shared/utilities'
import { v2Fixture } from './shared/fixtures'

import ExampleFlashSwap from '../build/ExampleFlashSwap.json'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
  gasPrice: 0
}

describe('ExampleFlashSwap', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let WND2: Contract
  let WND2Partner: Contract
  let WND2ExchangeV1: Contract
  let WND2Pair: Contract
  let flashSwapExample: Contract
  beforeEach(async function() {
    const fixture = await loadFixture(v2Fixture)

    WND2 = fixture.WND2
    WND2Partner = fixture.WND2Partner
    WND2ExchangeV1 = fixture.WND2ExchangeV1
    WND2Pair = fixture.WND2Pair
    flashSwapExample = await deployContract(
      wallet,
      ExampleFlashSwap,
      [fixture.factoryV2.address, fixture.factoryV1.address, fixture.router.address],
      overrides
    )
  })

  it('equixCall:0', async () => {
    // add liquidity to V1 at a rate of 1 ETH / 200 X
    const WND2PartnerAmountV1 = expandTo18Decimals(2000)
    const ETHAmountV1 = expandTo18Decimals(10)
    await WND2Partner.approve(WND2ExchangeV1.address, WND2PartnerAmountV1)
    await WND2ExchangeV1.addLiquidity(bigNumberify(1), WND2PartnerAmountV1, MaxUint256, {
      ...overrides,
      value: ETHAmountV1
    })

    // add liquidity to V2 at a rate of 1 ETH / 100 X
    const WND2PartnerAmountV2 = expandTo18Decimals(1000)
    const ETHAmountV2 = expandTo18Decimals(10)
    await WND2Partner.transfer(WND2Pair.address, WND2PartnerAmountV2)
    await WND2.deposit({ value: ETHAmountV2 })
    await WND2.transfer(WND2Pair.address, ETHAmountV2)
    await WND2Pair.mint(wallet.address, overrides)

    const balanceBefore = await WND2Partner.balanceOf(wallet.address)

    // now, execute arbitrage via equixCall:
    // receive 1 ETH from V2, get as much X from V1 as we can, repay V2 with minimum X, keep the rest!
    const arbitrageAmount = expandTo18Decimals(1)
    // instead of being 'hard-coded', the above value could be calculated optimally off-chain. this would be
    // better, but it'd be better yet to calculate the amount at runtime, on-chain. unfortunately, this requires a
    // swap-to-price calculation, which is a little tricky, and out of scope for the moment
    const WND2PairToken0 = await WND2Pair.token0()
    const amount0 = WND2PairToken0 === WND2Partner.address ? bigNumberify(0) : arbitrageAmount
    const amount1 = WND2PairToken0 === WND2Partner.address ? arbitrageAmount : bigNumberify(0)
    await WND2Pair.swap(
      amount0,
      amount1,
      flashSwapExample.address,
      defaultAbiCoder.encode(['uint'], [bigNumberify(1)]),
      overrides
    )

    const balanceAfter = await WND2Partner.balanceOf(wallet.address)
    const profit = balanceAfter.sub(balanceBefore).div(expandTo18Decimals(1))
    const reservesV1 = [
      await WND2Partner.balanceOf(WND2ExchangeV1.address),
      await provider.getBalance(WND2ExchangeV1.address)
    ]
    const priceV1 = reservesV1[0].div(reservesV1[1])
    const reservesV2 = (await WND2Pair.getReserves()).slice(0, 2)
    const priceV2 =
      WND2PairToken0 === WND2Partner.address ? reservesV2[0].div(reservesV2[1]) : reservesV2[1].div(reservesV2[0])

    expect(profit.toString()).to.eq('69') // our profit is ~69 tokens
    expect(priceV1.toString()).to.eq('165') // we pushed the v1 price down to ~165
    expect(priceV2.toString()).to.eq('123') // we pushed the v2 price up to ~123
  })

  it('equixCall:1', async () => {
    // add liquidity to V1 at a rate of 1 ETH / 100 X
    const WND2PartnerAmountV1 = expandTo18Decimals(1000)
    const ETHAmountV1 = expandTo18Decimals(10)
    await WND2Partner.approve(WND2ExchangeV1.address, WND2PartnerAmountV1)
    await WND2ExchangeV1.addLiquidity(bigNumberify(1), WND2PartnerAmountV1, MaxUint256, {
      ...overrides,
      value: ETHAmountV1
    })

    // add liquidity to V2 at a rate of 1 ETH / 200 X
    const WND2PartnerAmountV2 = expandTo18Decimals(2000)
    const ETHAmountV2 = expandTo18Decimals(10)
    await WND2Partner.transfer(WND2Pair.address, WND2PartnerAmountV2)
    await WND2.deposit({ value: ETHAmountV2 })
    await WND2.transfer(WND2Pair.address, ETHAmountV2)
    await WND2Pair.mint(wallet.address, overrides)

    const balanceBefore = await provider.getBalance(wallet.address)

    // now, execute arbitrage via equixCall:
    // receive 200 X from V2, get as much ETH from V1 as we can, repay V2 with minimum ETH, keep the rest!
    const arbitrageAmount = expandTo18Decimals(200)
    // instead of being 'hard-coded', the above value could be calculated optimally off-chain. this would be
    // better, but it'd be better yet to calculate the amount at runtime, on-chain. unfortunately, this requires a
    // swap-to-price calculation, which is a little tricky, and out of scope for the moment
    const WND2PairToken0 = await WND2Pair.token0()
    const amount0 = WND2PairToken0 === WND2Partner.address ? arbitrageAmount : bigNumberify(0)
    const amount1 = WND2PairToken0 === WND2Partner.address ? bigNumberify(0) : arbitrageAmount
    await WND2Pair.swap(
      amount0,
      amount1,
      flashSwapExample.address,
      defaultAbiCoder.encode(['uint'], [bigNumberify(1)]),
      overrides
    )

    const balanceAfter = await provider.getBalance(wallet.address)
    const profit = balanceAfter.sub(balanceBefore)
    const reservesV1 = [
      await WND2Partner.balanceOf(WND2ExchangeV1.address),
      await provider.getBalance(WND2ExchangeV1.address)
    ]
    const priceV1 = reservesV1[0].div(reservesV1[1])
    const reservesV2 = (await WND2Pair.getReserves()).slice(0, 2)
    const priceV2 =
      WND2PairToken0 === WND2Partner.address ? reservesV2[0].div(reservesV2[1]) : reservesV2[1].div(reservesV2[0])

    expect(formatEther(profit)).to.eq('0.548043441089763649') // our profit is ~.5 ETH
    expect(priceV1.toString()).to.eq('143') // we pushed the v1 price up to ~143
    expect(priceV2.toString()).to.eq('161') // we pushed the v2 price down to ~161
  })
})
