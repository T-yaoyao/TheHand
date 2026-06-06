import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import type { FilePlan } from '../services/api'

export function PlanView({ plan }: { plan: FilePlan[] | null }) {
  const containerRef = useRef<HTMLDivElement>(null)

  // GSAP: stagger-animate plan cards on mount
  useGSAP(() => {
    if (!containerRef.current || !plan?.length) return
    const cards = containerRef.current.querySelectorAll('.plan-card')
    gsap.from(cards, {
      y: 16,
      autoAlpha: 0,
      duration: 0.4,
      stagger: 0.08,
      ease: 'power2.out',
    })
  }, { dependencies: [plan?.length], scope: containerRef })

  if (!plan?.length) {
    return <p className="empty-panel">暂无技术方案，运行流水线后将在此展示。</p>
  }

  return (
    <div className="plan-list" ref={containerRef}>
      <div className="plan-summary">
        本次变更涉及 <strong>{plan.length}</strong> 个文件
      </div>
      {plan.map((file, i) => (
        <article key={file.path} className="plan-card">
          <div className="plan-card-head">
            <span className="plan-index">{i + 1}</span>
            <code className="plan-path">{file.path}</code>
            {file.priority != null && <span className="plan-priority">P{file.priority}</span>}
          </div>
          <p className="plan-desc">{file.changeDescription}</p>
        </article>
      ))}
    </div>
  )
}
