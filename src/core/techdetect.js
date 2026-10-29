// Technology-stack detection from response headers + HTML body.
//
// Every hit records the evidence that produced it (`detectedBy`), so a stack line is never
// a guess without a reason. Rules are pure functions over (headers, html) so they are
// unit-testable offline.

const HTML_SIGNATURES = [
  // [name, category, regex, note]
  ['WordPress', 'CMS', /<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i, 'generator meta'],
  ['WordPress', 'CMS', /wp-content\/|wp-includes\//i, 'wp-content path'],
  ['Drupal', 'CMS', /<meta[^>]+name=["']generator["'][^>]+content=["']Drupal/i, 'generator meta'],
  ['Drupal', 'CMS', /\/sites\/(default|all)\/themes\//i, 'drupal theme path'],
  ['Magento', 'eCommerce', /Magento_|Magento\/\d/i, 'JS global'],
  ['Shopify', 'eCommerce', /Shopify\.theme|cdn\.shopify\.com/i, 'shopify cdn'],
  ['WooCommerce', 'eCommerce', /woocommerce/i, 'woocommerce script'],
  ['Squarespace', 'CMS', /squarespace\.com|static1\.squarespace/i, 'squarespace assets'],
  ['Webflow', 'CMS', /webflow\.js|assets\.website-files\.com/i, 'webflow assets'],
  ['Contentful', 'CMS', /contentful\.com|graphql\.contentful\.com/i, 'contentful cdn'],
  ['Sentry', 'Analytics', /sentry-cdn\.com|browser\.sentry-cdn\.com/i, 'sentry cdn'],
  ['Google Analytics', 'Analytics', /googletagmanager\.com\/gtag\/js|google-analytics\.com\/analytics\.js|gtag\('config'/i, 'gtag snippet'],
  ['Google Tag Manager', 'Tag Manager', /googletagmanager\.com\/gtm\.js/i, 'gtm container'],
  ['Segment', 'Analytics', /cdn\.segment\.com\/analytics\.js/i, 'segment cdn'],
  ['Mixpanel', 'Analytics', /cdn\.mxpnl\.com|mixpanel/i, 'mixpanel cdn'],
  ['Amplitude', 'Analytics', /amplitude\.com\/api\.js/i, 'amplitude cdn'],
  ['Hotjar', 'Analytics', /static\.hotjar\.com|hjSetting/i, 'hotjar script'],
  ['Intercom', 'Support', /widget\.intercom\.io/i, 'intercom widget'],
  ['Drift', 'Support', /js\.driftt\.com/i, 'drift script'],
  ['HubSpot', 'CRM', /js\.hs-scripts\.com|hs-analytics|hubspot/i, 'hubspot script'],
  ['Marketo', 'CRM', /munchkin\.js|mktoForms/i, 'munchkin'],
  ['Salesforce', 'CRM', /pardot|force\.com/i, 'pardot/force'],
  ['Facebook Pixel', 'Ad Pixel', /connect\.facebook\.net\/.*\/fbevents\.js|fbq\('init'/i, 'pixel script'],
  ['Google Ads', 'Ad Pixel', /googleadservices\.com|googlesyndication\.com\/tag\/js\/gtag\/ds\.js/i, 'ads tag'],
  ['TikTok Pixel', 'Ad Pixel', /analytics\.tiktok\.com/i, 'tiktok pixel'],
  ['LinkedIn Insight', 'Ad Pixel', /snap\.licdn\.com\/li\.lms-analytics/i, 'linkedin insight'],
  ['Pinterest Tag', 'Ad Pixel', /s\.pinimg\.com\/ct\/pinterest\.js/i, 'pinterest tag'],
  ['React', 'Framework', /data-reactroot|__REACT_DEVTOOLS_GLOBAL_HOOK__|react(?:-dom)?(?:\.production)?(?:\.min)?\.js/i, 'react bundle'],
  ['Next.js', 'Framework', /\/_next\/static\//i, 'next static dir'],
  ['Nuxt', 'Framework', /\/_nuxt\//i, 'nuxt static dir'],
  ['Angular', 'Framework', /ng-version=|angular(?:\.min)?\.js/i, 'angular bundle'],
  ['Vue.js', 'Framework', /data-v-[0-9a-f]{8}|vue(?:\.runtime)?(?:\.min)?\.js/i, 'vue runtime'],
  ['Svelte', 'Framework', /svelte-[0-9a-z]{6,}\.js/i, 'svelte chunk'],
  ['jQuery', 'Library', /jquery[.-]?[0-9.]*(\.min)?\.js/i, 'jquery script'],
  ['Bootstrap', 'UI', /bootstrap(?:\.min)?\.(?:css|js)/i, 'bootstrap asset'],
  ['Tailwind CSS', 'UI', /tailwind/i, 'tailwind marker'],
  ['Cloudflare', 'CDN', /cdnjs\.cloudflare\.com|cf-ray/i, 'cf-ray header'],
  ['Akamai', 'CDN', /akamai|x-akamai/i, 'akamai header'],
  ['Fastly', 'CDN', /fastly|x-served-by.*fastly/i, 'fastly header'],
  ['Vercel', 'Hosting', /x-vercel|_vercel\//i, 'vercel header'],
  ['Netlify', 'Hosting', /x-nf-request-id|netlify/i, 'netlify header'],
  ['Google Fonts', 'Fonts', /fonts\.googleapis\.com|fonts\.gstatic\.com/i, 'google fonts'],
  ['reCAPTCHA', 'Security', /recaptcha|www\.google\.com\/recaptcha/i, 'recaptcha script'],
  ['Cloudflare Turnstile', 'Security', /challenges\.cloudflare\.com\/turnstile/i, 'turnstile script'],
];

const HEADER_SIGNATURES = [
  ['Cloudflare', 'CDN', 'server', /cloudflare/i],
  ['Cloudflare', 'CDN', 'cf-ray', /./],
  ['Vercel', 'Hosting', 'x-vercel-id', /./],
  ['Netlify', 'Hosting', 'x-nf-request-id', /./],
  ['Nginx', 'Server', 'server', /nginx/i],
  ['Apache', 'Server', 'server', /apache/i],
  ['Microsoft IIS', 'Server', 'server', /microsoft-iis/i],
  ['Amazon CloudFront', 'CDN', 'via', /cloudfront/i],
  ['Fastly', 'CDN', 'x-served-by', /fastly/i],
  ['Google', 'Hosting', 'server', /gse|gws/i],
  ['Shopify', 'eCommerce', 'x-shopid', /./],
  ['WordPress', 'CMS', 'x-powered-by', /wordpress|wp/i],
  ['PHP', 'Language', 'x-powered-by', /php/i],
  ['ASP.NET', 'Language', 'x-powered-by', /asp\.net|aspnet/i],
  ['Express', 'Framework', 'x-powered-by', /express/i],
  ['Next.js', 'Framework', 'x-powered-by', /Next\.js/i],
  ['Amazon S3', 'Hosting', 'server', /amazon?s3/i],
  ['Amazon CloudFront', 'CDN', 'x-amz-cf-id', /./],
  ['Cloudflare', 'CDN', 'x-cache', /cloudflare/i],
  ['Vercel', 'Hosting', 'x-vercel-cache', /./],
  ['SiteGround', 'Hosting', 'x-hosting', /siteground/i],
];

const CDN_HOST_HINTS = [
  ['Cloudflare', 'CDN', /cdnjs\.cloudflare\.com|\/cdn-cgi\//i],
  ['jsDelivr', 'CDN', /cdn\.jsdelivr\.net/i],
  ['unpkg', 'CDN', /unpkg\.com/i],
  ['Google Hosted Libraries', 'CDN', /ajax\.googleapis\.com/i],
  ['Bootstrap CDN', 'CDN', /maxcdn\.bootstrapcdn\.com|cdn\.jsdelivr\.net\/npm\/bootstrap/i],
];

/** Detect the technology stack from response headers and an HTML body. */
export function detectTech(headers = {}, html = '') {
  const found = new Map();
  const add = (name, category, detectedBy, version) => {
    const key = name.toLowerCase() + '|' + category;
    if (found.has(key)) {
      const e = found.get(key);
      if (!e.detectedBy.includes(detectedBy)) e.detectedBy.push(detectedBy);
      if (version && !e.version) e.version = version;
      return;
    }
    found.set(key, { name, category, detectedBy: [detectedBy], version: version || null });
  };

  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;

  for (const [name, category, header, re] of HEADER_SIGNATURES) {
    const v = h[header];
    if (v && re.test(String(v))) add(name, category, `header:${header}`);
  }
  if (h['x-powered-by']) add('Server framework', 'Server', `header:x-powered-by=${h['x-powered-by']}`);

  for (const [name, category, re, note] of HTML_SIGNATURES) {
    if (re.test(html)) add(name, category, `html:${note}`);
  }
  for (const [name, category, re] of CDN_HOST_HINTS) {
    if (re.test(html)) add(name, category, 'html:asset-host');
  }

  // Version hints from the server banner.
  const server = h['server'] ? String(h['server']) : null;
  if (server) {
    const m = server.match(/(\d+\.\d+(\.\d+)?)/);
    if (m) {
      for (const e of found.values()) {
        if (e.category === 'Server' || e.category === 'CDN' || e.category === 'Hosting') {
          if (!e.version) e.version = m[1];
        }
      }
    }
  }

  const out = [...found.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return out;
}

export const TECH_CATEGORIES = [
  'CMS',
  'Framework',
  'eCommerce',
  'CDN',
  'Hosting',
  'Server',
  'Language',
  'Analytics',
  'Tag Manager',
  'Ad Pixel',
  'CRM',
  'Support',
  'UI',
  'Library',
  'Fonts',
  'Security',
];
