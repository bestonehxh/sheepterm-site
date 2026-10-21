// sheepterm.com is the only address search engines should know.
// The project's production alias (sheepterm-web.pages.dev, and the old
// direct-upload project's sheepterm.pages.dev) redirects there; preview
// deployments (<hash>.sheepterm-web.pages.dev) stay reachable for checking
// but are marked noindex.
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname === "sheepterm-web.pages.dev" || url.hostname === "sheepterm.pages.dev") {
    url.hostname = "sheepterm.com";
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  const response = await next();
  if (url.hostname.endsWith(".pages.dev")) {
    const copy = new Response(response.body, response);
    copy.headers.set("X-Robots-Tag", "noindex");
    return copy;
  }
  return response;
}
