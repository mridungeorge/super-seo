// `sm utm <url> --source s --medium m [--campaign c --term t --content c]` — UTM link builder.

export async function run(ctx) {
  const [raw] = ctx.args._;
  const { source, medium, campaign, term, content } = ctx.args;
  if (!raw || !source || !medium) {
    console.error('usage: sm utm <url> --source <s> --medium <m> [--campaign <c>] [--term <t>] [--content <c>]');
    process.exitCode = 1;
    return;
  }
  const u = new URL(/^https?:\/\//.test(raw) ? raw : 'https://' + raw);
  const norm = (v) => String(v).trim().toLowerCase().replace(/\s+/g, '_');
  for (const [k, v] of Object.entries({ utm_source: source, utm_medium: medium, utm_campaign: campaign, utm_term: term, utm_content: content })) {
    if (v) u.searchParams.set(k, norm(v));
  }
  console.log(u.toString());
}
