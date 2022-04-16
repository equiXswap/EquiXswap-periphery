import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { AddressZero, MaxUint256 } from 'ethers/constants'
import { bigNumberify } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { v2Fixture } from './shared/fixtures'
import { expandTo18Decimals, MINIMUM_LIQUIDITY } from './shared/utilities'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('EquixMigrator', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let WND2Partner: Contract
  let WND2Pair: Contract
  let router: Contract
  let migrator: Contract
  let WND2ExchangeV1: Contract
  beforeEach(async function() {
    const fixture = await loadFixture(v2Fixture)
    WND2Partner = fixture.WND2Partner
    WND2Pair = fixture.WND2Pair
    router = fixture.router01 // we used router01 for this contract
    migrator = fixture.migrator
    WND2ExchangeV1 = fixture.WND2ExchangeV1
  })

  it('migrate', async () => {
    const WND2PartnerAmount = expandTo18Decimals(1)
    const ETHAmount = expandTo18Decimals(4)
    await WND2Partner.approve(WND2ExchangeV1.address, MaxUint256)
    await WND2ExchangeV1.addLiquidity(bigNumberify(1), WND2PartnerAmount, MaxUint256, {
      ...overrides,
      value: ETHAmount
    })
    await WND2ExchangeV1.approve(migrator.address, MaxUint256)
    const expectedLiquidity = expandTo18Decimals(2)
    const WND2PairToken0 = await WND2Pair.token0()
    await expect(
      migrator.migrate(WND2Partner.address, WND2PartnerAmount, ETHAmount, wallet.address, MaxUint256, overrides)
    )
      .to.emit(WND2Pair, 'Transfer')
      .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
      .to.emit(WND2Pair, 'Transfer')
      .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(WND2Pair, 'Sync')
      .withArgs(
        WND2PairToken0 === WND2Partner.address ? WND2PartnerAmount : ETHAmount,
        WND2PairToken0 === WND2Partner.address ? ETHAmount : WND2PartnerAmount
      )
      .to.emit(WND2Pair, 'Mint')
      .withArgs(
        router.address,
        WND2PairToken0 === WND2Partner.address ? WND2PartnerAmount : ETHAmount,
        WND2PairToken0 === WND2Partner.address ? ETHAmount : WND2PartnerAmount
      )
    expect(await WND2Pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
  })
})
