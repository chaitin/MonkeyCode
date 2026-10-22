"use client";
// Adapted from https://beui.dev/components/motion/bouncy-accordion (MIT).
// Copyright (c) 2026 Saurabh Chauhan. See public/licenses/beui.txt.

import { motion, useReducedMotion, type Transition } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { EASE_OUT } from "@/lib/ease";

export type BouncyAccordionItem = {
  id: string;
  title: string;
  description: string;
  icon?: ReactNode;
};

const ROW_TRANSITION: Transition = { type: "spring", duration: 0.55, bounce: 0.38 };
const CONTENT_OPEN_TRANSITION: Transition = { type: "spring", duration: 0.58, bounce: 0.32 };
const CONTENT_CLOSE_TRANSITION: Transition = { type: "spring", duration: 0.46, bounce: 0.26 };
const CHEVRON_TRANSITION: Transition = { type: "spring", duration: 0.42, bounce: 0.28 };

function AccordionRow({ item, open, startsGroup, endsGroup, separated, baseId, reduce, onToggle }: {
  item: BouncyAccordionItem;
  open: boolean;
  startsGroup: boolean;
  endsGroup: boolean;
  separated: boolean;
  baseId: string;
  reduce: boolean;
  onToggle: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const triggerId = `${baseId}-${item.id}-trigger`;
  const contentId = `${baseId}-${item.id}-content`;

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    const measure = () => setHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div layout="position" initial={false} style={{ marginTop: separated ? 12 : 0 }}
      transition={reduce ? { duration: 0 } : ROW_TRANSITION}>
      <motion.div data-accordion-item data-state={open ? "open" : "closed"} initial={false}
        animate={{ borderTopLeftRadius: startsGroup ? 28 : 0, borderTopRightRadius: startsGroup ? 28 : 0,
          borderBottomLeftRadius: endsGroup ? 28 : 0, borderBottomRightRadius: endsGroup ? 28 : 0 }}
        transition={reduce ? { duration: 0 } : ROW_TRANSITION} className="studio-accordion-item">
        <h3>
          <button id={triggerId} type="button" data-accordion-trigger aria-expanded={open} aria-controls={contentId}
            onClick={onToggle} className="studio-accordion-trigger">
            {item.icon && <span className="studio-accordion-icon" aria-hidden="true">{item.icon}</span>}
            <span className="studio-accordion-title">{item.title}</span>
            <motion.span aria-hidden="true" initial={false} animate={{ rotate: open ? 180 : 0 }}
              transition={reduce ? { duration: 0 } : CHEVRON_TRANSITION} className="studio-accordion-chevron">
              <ChevronDown size={18} />
            </motion.span>
          </button>
        </h3>
        <motion.div id={contentId} role="region" aria-labelledby={triggerId} aria-hidden={!open} inert={!open}
          initial={false} animate={{ height: open ? height : 0 }}
          transition={reduce ? { duration: 0 } : open ? CONTENT_OPEN_TRANSITION : CONTENT_CLOSE_TRANSITION}
          className="studio-accordion-content">
          <motion.div ref={contentRef} initial={false} animate={{ opacity: open ? 1 : 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT }}
            className="studio-accordion-description">
            <p>{item.description}</p>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export function BouncyAccordion({ items, defaultValue = null }: {
  items: BouncyAccordionItem[];
  defaultValue?: string | null;
}) {
  const [active, setActive] = useState(defaultValue);
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const activeIndex = items.findIndex(item => item.id === active);

  return (
    <div className="studio-faq-accordion" onKeyDown={event => {
      if (!(event.target instanceof HTMLButtonElement)) return;
      const triggers = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-accordion-trigger]'));
      const index = triggers.indexOf(event.target);
      let next: number;
      if (event.key === "ArrowDown") next = (index + 1) % triggers.length;
      else if (event.key === "ArrowUp") next = (index - 1 + triggers.length) % triggers.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = triggers.length - 1;
      else return;
      event.preventDefault();
      triggers[next]?.focus();
    }}>
      {items.map((item, index) => {
        const open = active === item.id;
        const previousOpen = activeIndex === index - 1;
        return <AccordionRow key={item.id} item={item} open={open} startsGroup={open || index === 0 || previousOpen}
          endsGroup={open || index === items.length - 1 || activeIndex === index + 1}
          separated={index > 0 && (open || previousOpen)} baseId={baseId} reduce={reduce}
          onToggle={() => setActive(open ? null : item.id)} />;
      })}
    </div>
  );
}
