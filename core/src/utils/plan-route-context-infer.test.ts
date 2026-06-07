import { describe, expect, it } from 'vitest'
import type { FilePlan, StructuredRequirement } from '../types.js'
import { inferRouteEntryContextFromRequirementAndPlan } from './plan-route-context-infer.js'

const baseReq = (over: Partial<StructuredRequirement>): StructuredRequirement => ({
  type: 'add_feature',
  entity: 'User',
  scope: 'frontend',
  description: 'x',
  ...over,
})

describe('plan-route-context-infer', () => {
  const profilePlan: FilePlan[] = [
    { path: 'frontend/src/routes/Profile/Profile.jsx', changeDescription: '新增 About Me Tab', priority: 1 },
  ]

  it('returns true when frontend scope, nested/tab signal in description, and plan touches routes/', () => {
    expect(
      inferRouteEntryContextFromRequirementAndPlan(
        baseReq({ description: '在个人主页新增 About Me Tab，与 My Articles 同级' }),
        profilePlan,
        '',
      ),
    ).toBe(true)
  })

  it('returns false when scope is backend', () => {
    expect(
      inferRouteEntryContextFromRequirementAndPlan(
        { ...baseReq({}), scope: 'backend', description: '新增 Tab 配置' },
        profilePlan,
        '',
      ),
    ).toBe(false)
  })

  it('returns false when no nested/tab signal', () => {
    expect(
      inferRouteEntryContextFromRequirementAndPlan(
        baseReq({ description: '文章详情页展示字数统计，基于 body 计算' }),
        [{ path: 'frontend/src/routes/Article/Article.jsx', changeDescription: '新增字数展示', priority: 1 }],
        '',
      ),
    ).toBe(false)
  })

  it('returns false when plan has no routes/ jsx', () => {
    expect(
      inferRouteEntryContextFromRequirementAndPlan(
        baseReq({ description: '新增 Tab 在设置页' }),
        [{ path: 'frontend/src/components/Settings/Tabs.jsx', changeDescription: 'Tab', priority: 1 }],
        '',
      ),
    ).toBe(false)
  })

  it('matches signal in pmInput when description is thin', () => {
    expect(
      inferRouteEntryContextFromRequirementAndPlan(
        baseReq({ description: '见 PM 说明' }),
        profilePlan,
        '新增子路由 about-me 与 Outlet',
      ),
    ).toBe(true)
  })
})
