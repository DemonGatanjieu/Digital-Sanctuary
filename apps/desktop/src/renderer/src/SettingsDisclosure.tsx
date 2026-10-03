import { useId, useState, type ReactNode } from "react";

/** Mount on demand, then retain drafts when collapsed or when the category changes. */
export function SettingsDisclosure({ title, description, children, name }: {
  title: string; description?: string; children: ReactNode; name?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  return <section className="settings-disclosure" data-disclosure={name}>
    <button type="button" className="settings-disclosure-toggle" aria-expanded={open} aria-controls={id}
      onClick={() => { setVisited(true); setOpen(!open); }}>
      <span><strong>{title}</strong>{description && <small>{description}</small>}</span>
      <span aria-hidden="true">{open ? "收起 −" : "展开 +"}</span>
    </button>
    {visited && <div id={id} className="settings-disclosure-content" hidden={!open}>{children}</div>}
  </section>;
}
