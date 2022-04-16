import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { AddressZero, Zero, MaxUint256 } from 'ethers/constants'
import { BigNumber, bigNumberify } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'
import { ecsign } from 'ethereumjs-util'

import { expandTo18Decimals, getApprovalDigest, mineBlock, MINIMUM_LIQUIDITY } from './shared/utilities'
import { v2Fixture } from './shared/fixtures'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

enum RouterVersion {
  EquixRouter01 = 'EquixRouter01',
  EquixRouter02 = 'EquixRouter02'
}

describe('EquixRouter{01,02}', () => {
  for (const routerVersion of Object.keys(RouterVersion)) {
    const provider = new MockProvider({
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999
    })
    const [wallet] = provider.getWallets()
    const loadFixture = createFixtureLoader(provider, [wallet])

    let token0: Contract
    let token1: Contract
    let WND2: Contract
    let WND2Partner: Contract
    let factory: Contract
    let router: Contract
    let pair: Contract
    let WND2Pair: Contract
    let routerEventEmitter: Contract
    beforeEach(async function() {
      const fixture = await loadFixture(v2Fixture)
      token0 = fixture.token0
      token1 = fixture.token1
      WND2 = fixture.WND2
      WND2Partner = fixture.WND2Partner
      factory = fixture.factoryV2
      router = {
        [RouterVersion.EquixRouter01]: fixture.router01,
        [RouterVersion.EquixRouter02]: fixture.router02
      }[routerVersion as RouterVersion]
      pair = fixture.pair
      WND2Pair = fixture.WND2Pair
      routerEventEmitter = fixture.routerEventEmitter
    })

    afterEach(async function() {
      expect(await provider.getBalance(router.address)).to.eq(Zero)
    })

    describe(routerVersion, () => {
      it('factory, WND2', async () => {
        expect(await router.factory()).to.eq(factory.address)
        expect(await router.WND2()).to.eq(WND2.address)
      })

      it('addLiquidity', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)

        const expectedLiquidity = expandTo18Decimals(2)
        await token0.approve(router.address, MaxUint256)
        await token1.approve(router.address, MaxUint256)
        await expect(
          router.addLiquidity(
            token0.address,
            token1.address,
            token0Amount,
            token1Amount,
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(token0, 'Transfer')
          .withArgs(wallet.address, pair.address, token0Amount)
          .to.emit(token1, 'Transfer')
          .withArgs(wallet.address, pair.address, token1Amount)
          .to.emit(pair, 'Transfer')
          .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
          .to.emit(pair, 'Transfer')
          .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(pair, 'Sync')
          .withArgs(token0Amount, token1Amount)
          .to.emit(pair, 'Mint')
          .withArgs(router.address, token0Amount, token1Amount)

        expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      })

      it('addLiquidityETH', async () => {
        const WND2PartnerAmount = expandTo18Decimals(1)
        const ETHAmount = expandTo18Decimals(4)

        const expectedLiquidity = expandTo18Decimals(2)
        const WND2PairToken0 = await WND2Pair.token0()
        await WND2Partner.approve(router.address, MaxUint256)
        await expect(
          router.addLiquidityETH(
            WND2Partner.address,
            WND2PartnerAmount,
            WND2PartnerAmount,
            ETHAmount,
            wallet.address,
            MaxUint256,
            { ...overrides, value: ETHAmount }
          )
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

      async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
        await token0.transfer(pair.address, token0Amount)
        await token1.transfer(pair.address, token1Amount)
        await pair.mint(wallet.address, overrides)
      }
      it('removeLiquidity', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)
        await addLiquidity(token0Amount, token1Amount)

        const expectedLiquidity = expandTo18Decimals(2)
        await pair.approve(router.address, MaxUint256)
        await expect(
          router.removeLiquidity(
            token0.address,
            token1.address,
            expectedLiquidity.sub(MINIMUM_LIQUIDITY),
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(pair, 'Transfer')
          .withArgs(wallet.address, pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(pair, 'Transfer')
          .withArgs(pair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(token0, 'Transfer')
          .withArgs(pair.address, wallet.address, token0Amount.sub(500))
          .to.emit(token1, 'Transfer')
          .withArgs(pair.address, wallet.address, token1Amount.sub(2000))
          .to.emit(pair, 'Sync')
          .withArgs(500, 2000)
          .to.emit(pair, 'Burn')
          .withArgs(router.address, token0Amount.sub(500), token1Amount.sub(2000), wallet.address)

        expect(await pair.balanceOf(wallet.address)).to.eq(0)
        const totalSupplyToken0 = await token0.totalSupply()
        const totalSupplyToken1 = await token1.totalSupply()
        expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(500))
        expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(2000))
      })

      it('removeLiquidityETH', async () => {
        const WND2PartnerAmount = expandTo18Decimals(1)
        const ETHAmount = expandTo18Decimals(4)
        await WND2Partner.transfer(WND2Pair.address, WND2PartnerAmount)
        await WND2.deposit({ value: ETHAmount })
        await WND2.transfer(WND2Pair.address, ETHAmount)
        await WND2Pair.mint(wallet.address, overrides)

        const expectedLiquidity = expandTo18Decimals(2)
        const WND2PairToken0 = await WND2Pair.token0()
        await WND2Pair.approve(router.address, MaxUint256)
        await expect(
          router.removeLiquidityETH(
            WND2Partner.address,
            expectedLiquidity.sub(MINIMUM_LIQUIDITY),
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(WND2Pair, 'Transfer')
          .withArgs(wallet.address, WND2Pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(WND2Pair, 'Transfer')
          .withArgs(WND2Pair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(WND2, 'Transfer')
          .withArgs(WND2Pair.address, router.address, ETHAmount.sub(2000))
          .to.emit(WND2Partner, 'Transfer')
          .withArgs(WND2Pair.address, router.address, WND2PartnerAmount.sub(500))
          .to.emit(WND2Partner, 'Transfer')
          .withArgs(router.address, wallet.address, WND2PartnerAmount.sub(500))
          .to.emit(WND2Pair, 'Sync')
          .withArgs(
            WND2PairToken0 === WND2Partner.address ? 500 : 2000,
            WND2PairToken0 === WND2Partner.address ? 2000 : 500
          )
          .to.emit(WND2Pair, 'Burn')
          .withArgs(
            router.address,
            WND2PairToken0 === WND2Partner.address ? WND2PartnerAmount.sub(500) : ETHAmount.sub(2000),
            WND2PairToken0 === WND2Partner.address ? ETHAmount.sub(2000) : WND2PartnerAmount.sub(500),
            router.address
          )

        expect(await WND2Pair.balanceOf(wallet.address)).to.eq(0)
        const totalSupplyWND2Partner = await WND2Partner.totalSupply()
        const totalSupplyWND2 = await WND2.totalSupply()
        expect(await WND2Partner.balanceOf(wallet.address)).to.eq(totalSupplyWND2Partner.sub(500))
        expect(await WND2.balanceOf(wallet.address)).to.eq(totalSupplyWND2.sub(2000))
      })

      it('removeLiquidityWithPermit', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)
        await addLiquidity(token0Amount, token1Amount)

        const expectedLiquidity = expandTo18Decimals(2)

        const nonce = await pair.nonces(wallet.address)
        const digest = await getApprovalDigest(
          pair,
          { owner: wallet.address, spender: router.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY) },
          nonce,
          MaxUint256
        )

        const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'))

        await router.removeLiquidityWithPermit(
          token0.address,
          token1.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          0,
          0,
          wallet.address,
          MaxUint256,
          false,
          v,
          r,
          s,
          overrides
        )
      })

      it('removeLiquidityETHWithPermit', async () => {
        const WND2PartnerAmount = expandTo18Decimals(1)
        const ETHAmount = expandTo18Decimals(4)
        await WND2Partner.transfer(WND2Pair.address, WND2PartnerAmount)
        await WND2.deposit({ value: ETHAmount })
        await WND2.transfer(WND2Pair.address, ETHAmount)
        await WND2Pair.mint(wallet.address, overrides)

        const expectedLiquidity = expandTo18Decimals(2)

        const nonce = await WND2Pair.nonces(wallet.address)
        const digest = await getApprovalDigest(
          WND2Pair,
          { owner: wallet.address, spender: router.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY) },
          nonce,
          MaxUint256
        )

        const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'))

        await router.removeLiquidityETHWithPermit(
          WND2Partner.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          0,
          0,
          wallet.address,
          MaxUint256,
          false,
          v,
          r,
          s,
          overrides
        )
      })

      describe('swapExactTokensForTokens', () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await addLiquidity(token0Amount, token1Amount)
          await token0.approve(router.address, MaxUint256)
        })

        it('happy path', async () => {
          await expect(
            router.swapExactTokensForTokens(
              swapAmount,
              0,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair.address, swapAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, expectedOutputAmount)
            .to.emit(pair, 'Sync')
            .withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
            .to.emit(pair, 'Swap')
            .withArgs(router.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address)
        })

        it('amounts', async () => {
          await token0.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapExactTokensForTokens(
              router.address,
              swapAmount,
              0,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })

        it('gas', async () => {
          // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          await pair.sync(overrides)

          await token0.approve(router.address, MaxUint256)
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          const tx = await router.swapExactTokensForTokens(
            swapAmount,
            0,
            [token0.address, token1.address],
            wallet.address,
            MaxUint256,
            overrides
          )
          const receipt = await tx.wait()
          expect(receipt.gasUsed).to.eq(
            {
              [RouterVersion.EquixRouter01]: 101876,
              [RouterVersion.EquixRouter02]: 101898
            }[routerVersion as RouterVersion]
          )
        }).retries(3)
      })

      describe('swapTokensForExactTokens', () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await addLiquidity(token0Amount, token1Amount)
        })

        it('happy path', async () => {
          await token0.approve(router.address, MaxUint256)
          await expect(
            router.swapTokensForExactTokens(
              outputAmount,
              MaxUint256,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair.address, expectedSwapAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, outputAmount)
            .to.emit(pair, 'Sync')
            .withArgs(token0Amount.add(expectedSwapAmount), token1Amount.sub(outputAmount))
            .to.emit(pair, 'Swap')
            .withArgs(router.address, expectedSwapAmount, 0, 0, outputAmount, wallet.address)
        })

        it('amounts', async () => {
          await token0.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapTokensForExactTokens(
              router.address,
              outputAmount,
              MaxUint256,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })

      describe('swapExactETHForTokens', () => {
        const WND2PartnerAmount = expandTo18Decimals(10)
        const ETHAmount = expandTo18Decimals(5)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await WND2Partner.transfer(WND2Pair.address, WND2PartnerAmount)
          await WND2.deposit({ value: ETHAmount })
          await WND2.transfer(WND2Pair.address, ETHAmount)
          await WND2Pair.mint(wallet.address, overrides)

          await token0.approve(router.address, MaxUint256)
        })

        it('happy path', async () => {
          const WND2PairToken0 = await WND2Pair.token0()
          await expect(
            router.swapExactETHForTokens(0, [WND2.address, WND2Partner.address], wallet.address, MaxUint256, {
              ...overrides,
              value: swapAmount
            })
          )
            .to.emit(WND2, 'Transfer')
            .withArgs(router.address, WND2Pair.address, swapAmount)
            .to.emit(WND2Partner, 'Transfer')
            .withArgs(WND2Pair.address, wallet.address, expectedOutputAmount)
            .to.emit(WND2Pair, 'Sync')
            .withArgs(
              WND2PairToken0 === WND2Partner.address
                ? WND2PartnerAmount.sub(expectedOutputAmount)
                : ETHAmount.add(swapAmount),
              WND2PairToken0 === WND2Partner.address
                ? ETHAmount.add(swapAmount)
                : WND2PartnerAmount.sub(expectedOutputAmount)
            )
            .to.emit(WND2Pair, 'Swap')
            .withArgs(
              router.address,
              WND2PairToken0 === WND2Partner.address ? 0 : swapAmount,
              WND2PairToken0 === WND2Partner.address ? swapAmount : 0,
              WND2PairToken0 === WND2Partner.address ? expectedOutputAmount : 0,
              WND2PairToken0 === WND2Partner.address ? 0 : expectedOutputAmount,
              wallet.address
            )
        })

        it('amounts', async () => {
          await expect(
            routerEventEmitter.swapExactETHForTokens(
              router.address,
              0,
              [WND2.address, WND2Partner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: swapAmount
              }
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })

        it('gas', async () => {
          const WND2PartnerAmount = expandTo18Decimals(10)
          const ETHAmount = expandTo18Decimals(5)
          await WND2Partner.transfer(WND2Pair.address, WND2PartnerAmount)
          await WND2.deposit({ value: ETHAmount })
          await WND2.transfer(WND2Pair.address, ETHAmount)
          await WND2Pair.mint(wallet.address, overrides)

          // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          await pair.sync(overrides)

          const swapAmount = expandTo18Decimals(1)
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          const tx = await router.swapExactETHForTokens(
            0,
            [WND2.address, WND2Partner.address],
            wallet.address,
            MaxUint256,
            {
              ...overrides,
              value: swapAmount
            }
          )
          const receipt = await tx.wait()
          expect(receipt.gasUsed).to.eq(
            {
              [RouterVersion.EquixRouter01]: 138770,
              [RouterVersion.EquixRouter02]: 138770
            }[routerVersion as RouterVersion]
          )
        }).retries(3)
      })

      describe('swapTokensForExactETH', () => {
        const WND2PartnerAmount = expandTo18Decimals(5)
        const ETHAmount = expandTo18Decimals(10)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await WND2Partner.transfer(WND2Pair.address, WND2PartnerAmount)
          await WND2.deposit({ value: ETHAmount })
          await WND2.transfer(WND2Pair.address, ETHAmount)
          await WND2Pair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          await WND2Partner.approve(router.address, MaxUint256)
          const WND2PairToken0 = await WND2Pair.token0()
          await expect(
            router.swapTokensForExactETH(
              outputAmount,
              MaxUint256,
              [WND2Partner.address, WND2.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(WND2Partner, 'Transfer')
            .withArgs(wallet.address, WND2Pair.address, expectedSwapAmount)
            .to.emit(WND2, 'Transfer')
            .withArgs(WND2Pair.address, router.address, outputAmount)
            .to.emit(WND2Pair, 'Sync')
            .withArgs(
              WND2PairToken0 === WND2Partner.address
                ? WND2PartnerAmount.add(expectedSwapAmount)
                : ETHAmount.sub(outputAmount),
              WND2PairToken0 === WND2Partner.address
                ? ETHAmount.sub(outputAmount)
                : WND2PartnerAmount.add(expectedSwapAmount)
            )
            .to.emit(WND2Pair, 'Swap')
            .withArgs(
              router.address,
              WND2PairToken0 === WND2Partner.address ? expectedSwapAmount : 0,
              WND2PairToken0 === WND2Partner.address ? 0 : expectedSwapAmount,
              WND2PairToken0 === WND2Partner.address ? 0 : outputAmount,
              WND2PairToken0 === WND2Partner.address ? outputAmount : 0,
              router.address
            )
        })

        it('amounts', async () => {
          await WND2Partner.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapTokensForExactETH(
              router.address,
              outputAmount,
              MaxUint256,
              [WND2Partner.address, WND2.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })

      describe('swapExactTokensForETH', () => {
        const WND2PartnerAmount = expandTo18Decimals(5)
        const ETHAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await WND2Partner.transfer(WND2Pair.address, WND2PartnerAmount)
          await WND2.deposit({ value: ETHAmount })
          await WND2.transfer(WND2Pair.address, ETHAmount)
          await WND2Pair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          await WND2Partner.approve(router.address, MaxUint256)
          const WND2PairToken0 = await WND2Pair.token0()
          await expect(
            router.swapExactTokensForETH(
              swapAmount,
              0,
              [WND2Partner.address, WND2.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(WND2Partner, 'Transfer')
            .withArgs(wallet.address, WND2Pair.address, swapAmount)
            .to.emit(WND2, 'Transfer')
            .withArgs(WND2Pair.address, router.address, expectedOutputAmount)
            .to.emit(WND2Pair, 'Sync')
            .withArgs(
              WND2PairToken0 === WND2Partner.address
                ? WND2PartnerAmount.add(swapAmount)
                : ETHAmount.sub(expectedOutputAmount),
              WND2PairToken0 === WND2Partner.address
                ? ETHAmount.sub(expectedOutputAmount)
                : WND2PartnerAmount.add(swapAmount)
            )
            .to.emit(WND2Pair, 'Swap')
            .withArgs(
              router.address,
              WND2PairToken0 === WND2Partner.address ? swapAmount : 0,
              WND2PairToken0 === WND2Partner.address ? 0 : swapAmount,
              WND2PairToken0 === WND2Partner.address ? 0 : expectedOutputAmount,
              WND2PairToken0 === WND2Partner.address ? expectedOutputAmount : 0,
              router.address
            )
        })

        it('amounts', async () => {
          await WND2Partner.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapExactTokensForETH(
              router.address,
              swapAmount,
              0,
              [WND2Partner.address, WND2.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })
      })

      describe('swapETHForExactTokens', () => {
        const WND2PartnerAmount = expandTo18Decimals(10)
        const ETHAmount = expandTo18Decimals(5)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await WND2Partner.transfer(WND2Pair.address, WND2PartnerAmount)
          await WND2.deposit({ value: ETHAmount })
          await WND2.transfer(WND2Pair.address, ETHAmount)
          await WND2Pair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          const WND2PairToken0 = await WND2Pair.token0()
          await expect(
            router.swapETHForExactTokens(
              outputAmount,
              [WND2.address, WND2Partner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: expectedSwapAmount
              }
            )
          )
            .to.emit(WND2, 'Transfer')
            .withArgs(router.address, WND2Pair.address, expectedSwapAmount)
            .to.emit(WND2Partner, 'Transfer')
            .withArgs(WND2Pair.address, wallet.address, outputAmount)
            .to.emit(WND2Pair, 'Sync')
            .withArgs(
              WND2PairToken0 === WND2Partner.address
                ? WND2PartnerAmount.sub(outputAmount)
                : ETHAmount.add(expectedSwapAmount),
              WND2PairToken0 === WND2Partner.address
                ? ETHAmount.add(expectedSwapAmount)
                : WND2PartnerAmount.sub(outputAmount)
            )
            .to.emit(WND2Pair, 'Swap')
            .withArgs(
              router.address,
              WND2PairToken0 === WND2Partner.address ? 0 : expectedSwapAmount,
              WND2PairToken0 === WND2Partner.address ? expectedSwapAmount : 0,
              WND2PairToken0 === WND2Partner.address ? outputAmount : 0,
              WND2PairToken0 === WND2Partner.address ? 0 : outputAmount,
              wallet.address
            )
        })

        it('amounts', async () => {
          await expect(
            routerEventEmitter.swapETHForExactTokens(
              router.address,
              outputAmount,
              [WND2.address, WND2Partner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: expectedSwapAmount
              }
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })
    })
  }
})
