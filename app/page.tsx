export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-950">
      <div className="mx-auto max-w-3xl">
        <section className="space-y-5">
          <p className="text-sm font-semibold uppercase text-teal-700">
            Rajadhani Stock Widget
          </p>
          <h1 className="text-4xl font-semibold sm:text-5xl">
            External widget host is ready.
          </h1>
          <p className="text-lg leading-8 text-slate-600">
            Use the hosted widget page as the external Index File in Zoho
            Creator. The widget reads live Creator report data when it is opened
            inside your Creator application.
          </p>
          <a
            className="inline-flex min-h-11 items-center rounded-md bg-teal-700 px-4 font-semibold text-white hover:bg-teal-800"
            href="/app/widget.html"
          >
            Open widget
          </a>
        </section>
      </div>
    </main>
  );
}
