import React, { useRef, useId } from 'react';

export function Tabs({ tabs, activeTab, onChange, label = 'Section tabs' }) {
  const baseId = useId();
  const buttonRefs = useRef([]);

  const handleKeyDown = (e, index) => {
    let nextIndex = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabs.length - 1;

    if (nextIndex !== null) {
      e.preventDefault();
      const targetTab = tabs[nextIndex];
      onChange(targetTab.id);
      buttonRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <div>
      <div role="tablist" aria-label={label} className="studio-tablist">
        {tabs.map((tab, idx) => {
          const isSelected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                buttonRefs.current[idx] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className="studio-tab inline-flex items-center gap-2 whitespace-nowrap cursor-pointer"
            >
              {tab.icon && <tab.icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => {
        const isSelected = tab.id === activeTab;
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${baseId}-panel-${tab.id}`}
            aria-labelledby={`${baseId}-tab-${tab.id}`}
            hidden={!isSelected}
            className="pt-5"
          >
            {isSelected ? tab.content : null}
          </div>
        );
      })}
    </div>
  );
}

