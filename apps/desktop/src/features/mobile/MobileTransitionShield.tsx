interface Props {
  title: string;
  children: string;
  titleId: string;
}

export function MobileTransitionShield({ title, children, titleId }: Props) {
  return (
    <main className="security-shield" aria-labelledby={titleId}>
      <section className="security-card">
        <h1 id={titleId}>{title}</h1>
        <p>{children}</p>
      </section>
    </main>
  );
}
