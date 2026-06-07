import { describe, it, expect } from 'vitest'
import { extractOutletRelativeNavSegments, routeTableDeclaresSegment } from './outlet-nav-route-guard.js'

describe('outlet-nav-route-guard', () => {
  it('extracts relative NavItem url when Outlet is present in the same file', () => {
    const layout = `
import { Outlet } from 'react-router-dom'
export default function P() {
  return <>
    <NavItem text="About Me" url="about-me" state={s} />
    <Outlet />
  </>
}`
    expect(extractOutletRelativeNavSegments(layout)).toContain('about-me')
  })

  it('returns empty when there is no Outlet', () => {
    expect(extractOutletRelativeNavSegments('<NavItem url="about-me" />')).toEqual([])
  })

  it('skips absolute NavItem urls', () => {
    const src = `<Outlet /><NavItem url="/settings" />`
    expect(extractOutletRelativeNavSegments(src)).toEqual([])
  })

  it('routeTableDeclaresSegment matches Route path attribute', () => {
    const routes = '<Route path="about-me" element={<X />} />'
    expect(routeTableDeclaresSegment(routes, 'about-me')).toBe(true)
    expect(routeTableDeclaresSegment(routes, 'missing')).toBe(false)
  })
})
