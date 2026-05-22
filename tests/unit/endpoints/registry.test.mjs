import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildEndpointHealthProbeRequest,
  buildEndpointRequest,
  endpointRegistry,
  getEndpoint,
  listCategories,
  listEndpoints,
  recommendEndpoint,
  validateRegistry,
} from "../../../packages/router-core/src/endpoints/index.ts";
import {
  agentmailPriceUsd,
  manusResearchPriceForDepth,
  parallelExtractPriceUsd,
  parallelSearchPriceUsd,
  parallelTaskPriceForProcessor,
  stabletravelMaxUsd,
  stabletravelPriceUsd,
} from "../../../packages/router-core/src/endpoints/builders.ts";
import {
  assertEndpointFixtureBuilds,
  assertEndpointHealthProbeBuilds,
  assertValidEndpointRegistry,
} from "../../../packages/router-core/src/testing/endpointHarness.ts";

function rollingDate(daysFromToday) {
  const today = new Date();
  const date = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() + daysFromToday,
  ));
  return date.toISOString().slice(0, 10);
}

describe("endpoint registry", () => {
  it("validates the launch registry", () => {
    assert.equal(validateRegistry(), true);
    assert.deepEqual(
      listEndpoints().map((endpoint) => endpoint.id),
      [
        "browserbase.session",
        "exa.search",
        "parallel.search",
        "parallel.extract",
        "manus.research",
        "parallel.task",
        "stabletravel.locations",
        "stabletravel.google_flights_search",
        "stabletravel.hotels_list",
        "stabletravel.hotels_search",
        "stabletravel.flightaware_flights",
        "agentmail.create_inbox",
        "agentmail.list_messages",
        "agentmail.get_message",
        "agentmail.send_message",
        "agentmail.reply_to_message",
      ],
    );
    assertValidEndpointRegistry(endpointRegistry);
    for (const endpoint of endpointRegistry) {
      assertEndpointFixtureBuilds(endpoint);
      assertEndpointHealthProbeBuilds(endpoint);
    }
  });

  it("groups endpoints into generic categories with recommendations", () => {
    const categories = listCategories();
    assert.deepEqual(
      categories.map((category) => category.id),
      ["search", "research", "extract", "email", "browser_usage", "travel"],
    );

    const search = categories.find((category) => category.id === "search");
    assert.equal(search.name, "Search");
    assert.equal(search.recommended_endpoint_id, "exa.search");
    assert.deepEqual(
      search.endpoints.map((endpoint) => endpoint.id),
      ["exa.search", "parallel.search"],
    );

    const browserUse = recommendEndpoint("browser_usage");
    assert.equal(browserUse.id, "browserbase.session");

    const research = recommendEndpoint("research");
    assert.equal(research.id, "manus.research");

    const extract = recommendEndpoint("extract");
    assert.equal(extract.id, "parallel.extract");

    const email = categories.find((category) => category.id === "email");
    assert.equal(email.name, "Email");
    assert.equal(email.recommended_endpoint_id, "agentmail.send_message");
    assert.equal(email.recommended_endpoint.id, "agentmail.send_message");
    assert.deepEqual(
      email.endpoints.map((endpoint) => endpoint.id),
      [
        "agentmail.create_inbox",
        "agentmail.list_messages",
        "agentmail.get_message",
        "agentmail.send_message",
        "agentmail.reply_to_message",
      ],
    );
    assert.equal(recommendEndpoint("email").id, "agentmail.send_message");

    const travel = categories.find((category) => category.id === "travel");
    assert.equal(travel.name, "Travel");
    assert.equal(travel.recommended_endpoint_id, "stabletravel.google_flights_search");
    assert.equal(travel.recommended_endpoint.id, "stabletravel.google_flights_search");
    assert.deepEqual(
      travel.endpoints.map((endpoint) => endpoint.id),
      [
        "stabletravel.locations",
        "stabletravel.google_flights_search",
        "stabletravel.hotels_list",
        "stabletravel.hotels_search",
        "stabletravel.flightaware_flights",
      ],
    );
    assert.equal(recommendEndpoint("travel").id, "stabletravel.google_flights_search");
  });

  it("builds Parallel Search requests with the per-call markup price", () => {
    assert.throws(
      () => buildEndpointRequest("parallel.search", { search_queries: [] }),
      /search_queries must include at least 1 item/u,
    );
    assert.throws(
      () => buildEndpointRequest("parallel.search", { search_queries: ["x"], mode: "bogus" }),
      /unsupported Parallel search mode/u,
    );

    const request = buildEndpointRequest("parallel.search", {
      search_queries: ["top sushi places in San Francisco"],
      objective: "Find the highest-rated sushi restaurants",
      mode: "advanced",
    });
    assert.equal(request.method, "POST");
    assert.ok(request.url.endsWith("/x402/parallel/search"));
    assert.equal(request.headers["x-api-key"], undefined);
    assert.deepEqual(request.json, {
      search_queries: ["top sushi places in San Francisco"],
      mode: "advanced",
      objective: "Find the highest-rated sushi restaurants",
    });
    assert.equal(request.estimatedUsd, "0.02");
    assert.equal(parallelSearchPriceUsd(), "0.02");

    const probe = buildEndpointHealthProbeRequest("parallel.search");
    assert.equal(probe.paymentMode, "x402_only");
    assert.equal(probe.maxUsd, "0.02");

    const endpoint = getEndpoint("parallel.search");
    assert.equal(endpoint.agentkit, false);
    assert.equal(endpoint.agentkit_value_type, null);
    assert.equal(endpoint.agentkit_value_label, null);
    assert.equal(endpoint.defaultPaymentMode, "x402_only");
    assert.equal(endpoint.agentkitHealthProbe, null);
  });

  it("builds Parallel Extract requests priced per URL plus markup", () => {
    assert.throws(
      () => buildEndpointRequest("parallel.extract", { urls: [] }),
      /urls must include at least 1 item/u,
    );
    assert.throws(
      () => buildEndpointRequest("parallel.extract", { urls: ["http://example.com"] }),
      /urls\[0\] must use https/u,
    );

    const single = buildEndpointRequest("parallel.extract", {
      urls: ["https://example.com"],
    });
    assert.equal(single.method, "POST");
    assert.ok(single.url.endsWith("/x402/parallel/extract"));
    assert.deepEqual(single.json, { urls: ["https://example.com/"] });
    assert.equal(single.estimatedUsd, "0.02");
    assert.equal(parallelExtractPriceUsd(1), "0.02");

    const five = buildEndpointRequest("parallel.extract", {
      urls: [
        "https://a.example.com",
        "https://b.example.com",
        "https://c.example.com",
        "https://d.example.com",
        "https://e.example.com",
      ],
      objective: "Compare landing pages",
      full_content: true,
    });
    assert.equal(five.estimatedUsd, "0.06");
    assert.deepEqual(five.json.advanced_settings, { full_content: true });
    assert.equal(parallelExtractPriceUsd(5), "0.06");

    const endpoint = getEndpoint("parallel.extract");
    assert.equal(endpoint.agentkit, false);
    assert.equal(endpoint.agentkit_value_type, null);
    assert.equal(endpoint.agentkit_value_label, null);
    assert.equal(endpoint.defaultPaymentMode, "x402_only");
    assert.equal(endpoint.agentkitHealthProbe, null);
  });

  it("builds Parallel Task requests with processor pricing", () => {
    assert.throws(
      () => buildEndpointRequest("parallel.task", { input: "x", processor: "mega" }),
      /unsupported Parallel task processor/u,
    );
    assert.throws(
      () => buildEndpointRequest("parallel.task", { processor: "core" }),
      /input is required/u,
    );

    const core = buildEndpointRequest("parallel.task", {
      input: "Find the best MCP browser automation tools",
      processor: "core",
    });
    assert.equal(core.method, "POST");
    assert.ok(core.url.endsWith("/x402/parallel/task"));
    assert.equal(core.json.processor, "core");
    assert.equal(core.estimatedUsd, "0.035");
    assert.equal(parallelTaskPriceForProcessor("core"), "0.035");

    const endpoint = getEndpoint("parallel.task");
    assert.equal(endpoint.agentkit, false);
    assert.equal(endpoint.agentkit_value_type, null);
    assert.equal(endpoint.agentkit_value_label, null);
    assert.equal(endpoint.defaultPaymentMode, "x402_only");
    assert.equal(endpoint.agentkitHealthProbe, null);

    const ultra = buildEndpointRequest("parallel.task", {
      input: "Deep research brief",
      processor: "ultra",
    });
    assert.equal(ultra.estimatedUsd, "0.31");
    assert.equal(parallelTaskPriceForProcessor("ultra"), "0.31");

    const probe = buildEndpointHealthProbeRequest("parallel.task");
    assert.equal(probe.paymentMode, "x402_only");
    assert.equal(probe.timeoutMs, 30_000);
  });

  it("uses configured Parallel task prices via env override", () => {
    const previous = process.env.TOOLROUTER_PARALLEL_TASK_PRICE_CORE_USD;
    process.env.TOOLROUTER_PARALLEL_TASK_PRICE_CORE_USD = "0.05";
    try {
      assert.equal(parallelTaskPriceForProcessor("core"), "0.06");
      const request = buildEndpointRequest("parallel.task", {
        input: "Configured price check",
        processor: "core",
      });
      assert.equal(request.estimatedUsd, "0.06");
    } finally {
      if (previous === undefined) delete process.env.TOOLROUTER_PARALLEL_TASK_PRICE_CORE_USD;
      else process.env.TOOLROUTER_PARALLEL_TASK_PRICE_CORE_USD = previous;
    }
  });

  it("builds Exa search requests from typed input", () => {
    const defaultRequest = buildEndpointRequest("exa.search", {
      query: "AgentKit",
    });
    assert.equal(defaultRequest.json.type, "fast");
    assert.equal(defaultRequest.json.numResults, 5);

    const request = buildEndpointRequest("exa.search", {
      query: "AgentKit",
      search_type: "fast",
      num_results: 2,
      include_summary: true,
    });
    assert.equal(request.method, "POST");
    assert.equal(request.url, "https://api.exa.ai/search");
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers["x-api-key"], undefined);
    assert.deepEqual(request.json, {
      query: "AgentKit",
      type: "fast",
      numResults: 2,
      contents: { summary: true },
    });
    assert.equal(request.estimatedUsd, "0.009");
  });

  it("builds the Exa AgentKit-first health probe", () => {
    const probe = buildEndpointHealthProbeRequest("exa.search");
    assert.equal(probe.request.url, "https://api.exa.ai/search");
    assert.deepEqual(probe.request.json, {
      query: "ToolRouter health check",
      type: "fast",
      numResults: 5,
    });
    assert.equal(probe.maxUsd, "0.01");
  });

  it("builds Browserbase AgentKit-access session requests from typed input", () => {
    assert.throws(
      () => buildEndpointRequest("browserbase.session", { estimated_minutes: 1 }),
      /estimatedMinutes must be between 5 and 120/,
    );

    const session = buildEndpointRequest("browserbase.session", { estimated_minutes: 5 });
    assert.equal(session.url, "https://x402.browserbase.com/browser/session/create");
    assert.deepEqual(session.json, { estimatedMinutes: 5 });
    assert.equal(session.estimatedUsd, "0.01");
  });

  it("uses a longer Browserbase session health timeout than fast endpoints", () => {
    const probe = buildEndpointHealthProbeRequest("browserbase.session");
    assert.equal(probe.maxUsd, "0.02");
    assert.equal(probe.paymentMode, "x402_only");
    assert.equal(probe.timeoutMs, 15_000);
    assert.equal(probe.latencyBudgetMs, 10_000);
  });

  it("builds Manus research requests for the ToolRouter x402 wrapper", () => {
    assert.throws(
      () =>
        buildEndpointRequest("manus.research", {
          query: "Find a tool for visual product lookup",
          urls: ["http://example.com/docs"],
        }),
      /urls\[0\] must use https/u,
    );
    assert.throws(
      () =>
        buildEndpointRequest("manus.research", {
          query: "Find a tool for visual product lookup",
          images: ["not-a-url"],
        }),
      /images\[0\] must be a valid URL/u,
    );

    const request = buildEndpointRequest("manus.research", {
      query: "Find a tool for visual product lookup",
      task_type: "tool_discovery",
      depth: "quick",
      urls: ["https://example.com/docs"],
      images: ["https://example.com/image.png"],
    });
    assert.equal(request.method, "POST");
    assert.equal(request.url, "https://toolrouter.world/x402/manus/research");
    assert.deepEqual(request.json, {
      query: "Find a tool for visual product lookup",
      depth: "quick",
      task_type: "tool_discovery",
      urls: ["https://example.com/docs"],
      images: ["https://example.com/image.png"],
    });
    assert.equal(request.estimatedUsd, "0.03");

    const deepRequest = buildEndpointRequest("manus.research", {
      query: "Build a detailed research brief",
      depth: "deep",
    });
    assert.equal(deepRequest.estimatedUsd, "0.1");

    const probe = buildEndpointHealthProbeRequest("manus.research");
    assert.equal(probe.paymentMode, "x402_only");
    assert.equal(probe.maxUsd, "0.03");
    assert.equal(probe.timeoutMs, 30_000);
  });

  it("uses configured Manus prices for dynamic request estimates", () => {
    const previous = process.env.TOOLROUTER_MANUS_RESEARCH_PRICE_QUICK_USD;
    process.env.TOOLROUTER_MANUS_RESEARCH_PRICE_QUICK_USD = "0.04";
    try {
      assert.equal(manusResearchPriceForDepth("quick"), "0.04");
      const request = buildEndpointRequest("manus.research", {
        query: "Quick configured price check",
        depth: "quick",
      });
      assert.equal(request.estimatedUsd, "0.04");
    } finally {
      if (previous === undefined) delete process.env.TOOLROUTER_MANUS_RESEARCH_PRICE_QUICK_USD;
      else process.env.TOOLROUTER_MANUS_RESEARCH_PRICE_QUICK_USD = previous;
    }
  });

  it("builds AgentMail x402-only inbox and message requests", () => {
    const create = buildEndpointRequest("agentmail.create_inbox", {
      username: "toolrouter-test",
      displayName: "ToolRouter Test",
      clientId: "tr-test-inbox",
    });
    assert.equal(create.method, "POST");
    assert.ok(create.url.endsWith("/x402/agentmail/inboxes"));
    assert.deepEqual(create.json, {
      username: "toolrouter-test",
      display_name: "ToolRouter Test",
      client_id: "tr-test-inbox",
    });
    assert.equal(create.estimatedUsd, "2.01");
    assert.equal(agentmailPriceUsd("create_inbox"), "2.01");

    const list = buildEndpointRequest("agentmail.list_messages", {
      inbox_id: "agent@agentmail.to",
      limit: 5,
      labels: ["toolrouter"],
      include_trash: true,
    });
    assert.equal(list.method, "POST");
    assert.ok(list.url.endsWith("/x402/agentmail/messages/list"));
    assert.deepEqual(list.json, {
      inbox_id: "agent@agentmail.to",
      limit: 5,
      labels: ["toolrouter"],
      include_trash: true,
    });
    assert.equal(list.estimatedUsd, "0.01");

    const get = buildEndpointRequest("agentmail.get_message", {
      inboxId: "agent@agentmail.to",
      messageId: "msg_123",
    });
    assert.equal(get.method, "POST");
    assert.ok(get.url.endsWith("/x402/agentmail/messages/get"));
    assert.deepEqual(get.json, {
      inbox_id: "agent@agentmail.to",
      message_id: "msg_123",
    });
    assert.equal(get.estimatedUsd, "0.01");

    const send = buildEndpointRequest("agentmail.send_message", {
      inbox_id: "agent@agentmail.to",
      to: ["recipient@example.com"],
      replyTo: "reply@example.com",
      subject: "Hello",
      text: "Plain text body",
      labels: ["toolrouter"],
      max_usd: "ignored-control-field",
    });
    assert.equal(send.method, "POST");
    assert.ok(send.url.endsWith("/x402/agentmail/messages/send"));
    assert.deepEqual(send.json, {
      inbox_id: "agent@agentmail.to",
      to: ["recipient@example.com"],
      reply_to: "reply@example.com",
      subject: "Hello",
      text: "Plain text body",
      labels: ["toolrouter"],
    });
    assert.equal(send.estimatedUsd, "0.02");
    assert.equal(agentmailPriceUsd("send_message"), "0.02");

    const subjectlessSend = buildEndpointRequest("agentmail.send_message", {
      inbox_id: "agent@agentmail.to",
      to: "recipient@example.com",
      text: "Subjectless body",
    });
    assert.deepEqual(subjectlessSend.json, {
      inbox_id: "agent@agentmail.to",
      to: "recipient@example.com",
      text: "Subjectless body",
    });

    const reply = buildEndpointRequest("agentmail.reply_to_message", {
      inbox_id: "agent@agentmail.to",
      message_id: "msg_123",
      html: "<p>Thanks</p>",
      replyAll: true,
    });
    assert.ok(reply.url.endsWith("/x402/agentmail/messages/reply"));
    assert.deepEqual(reply.json, {
      inbox_id: "agent@agentmail.to",
      message_id: "msg_123",
      html: "<p>Thanks</p>",
      reply_all: true,
    });
    assert.equal(reply.estimatedUsd, "0.02");
    assert.equal(agentmailPriceUsd("reply_to_message"), "0.02");
  });

  it("validates AgentMail required fields and recipient caps", () => {
    assert.throws(
      () => buildEndpointRequest("agentmail.list_messages", { limit: 5 }),
      /inbox_id is required/u,
    );
    assert.throws(
      () => buildEndpointRequest("agentmail.get_message", { inbox_id: "agent@agentmail.to" }),
      /message_id is required/u,
    );
    assert.throws(
      () =>
        buildEndpointRequest("agentmail.send_message", {
          inbox_id: "agent@agentmail.to",
          to: "recipient@example.com",
          subject: "Hello",
        }),
      /text or html is required/u,
    );
    assert.throws(
      () =>
        buildEndpointRequest("agentmail.send_message", {
          inbox_id: "agent@agentmail.to",
          to: [],
          subject: "Hello",
          text: "Body",
        }),
      /to is required/u,
    );
    assert.throws(
      () =>
        buildEndpointRequest("agentmail.send_message", {
          inbox_id: "agent@agentmail.to",
          to: Array.from({ length: 51 }, (_, index) => `r${index}@example.com`),
          subject: "Hello",
          text: "Body",
        }),
      /to must include at most 50 items/u,
    );
  });

  it("builds StableTravel direct x402 GET requests", () => {
    const outboundDate = rollingDate(30);
    const returnDate = rollingDate(35);
    const checkInDate = rollingDate(30);
    const checkOutDate = rollingDate(31);
    const locations = buildEndpointRequest("stabletravel.locations", {
      query: "Paris",
      sub_type: "CITY",
      country_code: "FR",
      limit: 1,
    });
    assert.equal(locations.method, "GET");
    assert.equal(locations.url, "https://stabletravel.dev/api/reference/locations?subType=CITY&keyword=Paris&countryCode=FR&page%5Blimit%5D=1&view=LIGHT");
    assert.equal(locations.json, undefined);
    assert.equal(locations.estimatedUsd, "0.0054");
    assert.equal(stabletravelPriceUsd("locations"), "0.0054");

    const flights = buildEndpointRequest("stabletravel.google_flights_search", {
      departure_id: "sfo",
      arrival_id: "jfk",
      outbound_date: outboundDate,
      type: "2",
      include_airlines: ["UA", "AA"],
    });
    assert.equal(flights.method, "GET");
    assert.equal(
      flights.url,
      `https://stabletravel.dev/api/google-flights/search?departure_id=sfo&arrival_id=jfk&outbound_date=${outboundDate}&type=2&adults=1&children=0&infants_in_seat=0&infants_on_lap=0&include_airlines=UA%2CAA&currency=USD&hl=en`,
    );
    assert.equal(flights.estimatedUsd, "0.02");
    assert.equal(stabletravelPriceUsd("google_flights_search"), "0.02");

    const roundTripFlights = buildEndpointRequest("stabletravel.google_flights_search", {
      departure_id: "SFO",
      arrival_id: "JFK",
      outbound_date: outboundDate,
      return_date: returnDate,
    });
    assert.ok(roundTripFlights.url.includes("type=1"));
    assert.ok(roundTripFlights.url.includes(`return_date=${returnDate}`));

    const rollingFlightProbe = buildEndpointHealthProbeRequest("stabletravel.google_flights_search");
    assert.ok(rollingFlightProbe.request.url.includes(`outbound_date=${rollingDate(30)}`));

    const hotelsList = buildEndpointRequest("stabletravel.hotels_list", {
      city_code: "par",
      max: 5,
      ratings: ["4", "5"],
    });
    assert.equal(hotelsList.url, "https://stabletravel.dev/api/hotels/list?cityCode=PAR&ratings=4%2C5&max=5");
    assert.equal(hotelsList.estimatedUsd, "0.0324");

    const hotelsSearch = buildEndpointRequest("stabletravel.hotels_search", {
      hotel_ids: ["HLPAR266", "HLPAR123"],
      adults: 2,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      currency_code: "usd",
      best_rate_only: true,
    });
    assert.equal(
      hotelsSearch.url,
      `https://stabletravel.dev/api/hotels/search?hotelIds=HLPAR266%2CHLPAR123&adults=2&checkInDate=${checkInDate}&checkOutDate=${checkOutDate}&currencyCode=USD&bestRateOnly=true`,
    );
    assert.equal(hotelsSearch.estimatedUsd, "0.0324");

    const rollingHotelProbe = buildEndpointHealthProbeRequest("stabletravel.hotels_search");
    assert.ok(rollingHotelProbe.request.url.includes(`checkInDate=${rollingDate(30)}`));
    assert.ok(rollingHotelProbe.request.url.includes(`checkOutDate=${rollingDate(31)}`));

    const flightLookup = buildEndpointRequest("stabletravel.flightaware_flights", {
      ident: "UAL123",
      max_pages: 1,
    });
    assert.equal(
      flightLookup.url,
      "https://stabletravel.dev/api/flightaware/flights/UAL123?ident_type=designator&max_pages=1",
    );
    assert.equal(flightLookup.estimatedUsd, "0.01");

    const endpoint = getEndpoint("stabletravel.google_flights_search");
    assert.equal(endpoint.agentkit, false);
    assert.equal(endpoint.agentkit_value_type, null);
    assert.equal(endpoint.agentkit_value_label, null);
    assert.equal(endpoint.defaultPaymentMode, "x402_only");
    assert.equal(endpoint.agentkitHealthProbe, null);
  });

  it("validates StableTravel inputs before payment", () => {
    const outboundDate = rollingDate(30);
    const earlierDate = rollingDate(25);

    assert.throws(
      () => buildEndpointRequest("stabletravel.locations", { sub_type: "CITY" }),
      /keyword is required/u,
    );
    assert.throws(
      () =>
        buildEndpointRequest("stabletravel.google_flights_search", {
          departure_id: "SFO",
          arrival_id: "JFK",
          outbound_date: outboundDate.replaceAll("-", "/"),
        }),
      /outbound_date must use YYYY-MM-DD/u,
    );
    assert.throws(
      () =>
        buildEndpointRequest("stabletravel.google_flights_search", {
          departure_id: "SFO",
          arrival_id: "JFK",
          outbound_date: "2026-13-40",
        }),
      /outbound_date must be a valid calendar date/u,
    );
    assert.throws(
      () =>
        buildEndpointRequest("stabletravel.google_flights_search", {
          departure_id: "SFO",
          arrival_id: "JFK",
          outbound_date: outboundDate,
          type: "1",
        }),
      /return_date is required/u,
    );
    assert.throws(
      () =>
        buildEndpointRequest("stabletravel.google_flights_search", {
          departure_id: "SFO",
          arrival_id: "JFK",
          outbound_date: outboundDate,
          return_date: earlierDate,
        }),
      /return_date must be on or after outbound_date/u,
    );
    assert.throws(
      () => buildEndpointRequest("stabletravel.hotels_list", { city_code: "Paris" }),
      /cityCode must be a 3-letter IATA city code/u,
    );
    assert.throws(
      () => buildEndpointRequest("stabletravel.hotels_search", { adults: 1 }),
      /hotelIds is required/u,
    );
    assert.throws(
      () =>
        buildEndpointRequest("stabletravel.hotels_search", {
          hotel_ids: Array.from({ length: 21 }, (_, index) => `HOTEL${index}`).join(","),
        }),
      /hotelIds must include at most 20 items/u,
    );
    assert.throws(
      () =>
        buildEndpointRequest("stabletravel.hotels_search", {
          hotel_ids: ["HLPAR266"],
          check_in_date: outboundDate,
          check_out_date: outboundDate,
        }),
      /checkOutDate must be after checkInDate/u,
    );
    assert.throws(
      () =>
        buildEndpointRequest("stabletravel.google_flights_search", {
          departure_id: "SFO",
          arrival_id: "JFK",
          outbound_date: outboundDate,
          type: "2",
          include_airlines: Array.from({ length: 21 }, (_, index) => `A${index}`).join(","),
        }),
      /include_airlines must include at most 20 items/u,
    );
    assert.throws(
      () =>
        buildEndpointRequest("stabletravel.google_flights_search", {
          departure_id: "SFO",
          arrival_id: "JFK",
          outbound_date: outboundDate,
          type: "2",
          include_airlines: Array.from({ length: 11 }, (_, index) => `A${index},B${index}`),
        }),
      /include_airlines must include at most 20 items/u,
    );
    assert.throws(
      () => buildEndpointRequest("stabletravel.flightaware_flights", { ident: "!" }),
      /ident must be a flight designator/u,
    );
  });

  it("keeps StableTravel user-visible prices and buffered caps aligned with execution caps", () => {
    for (const [endpointId, priceKind, maxKind] of [
      ["stabletravel.locations", "locations", "locations"],
      ["stabletravel.google_flights_search", "google_flights_search", "google_flights_search"],
      ["stabletravel.hotels_list", "hotels_list", "hotels_list"],
      ["stabletravel.hotels_search", "hotels_search", "hotels_search"],
      ["stabletravel.flightaware_flights", "flightaware_flights", "flightaware_flights"],
    ]) {
      const endpoint = getEndpoint(endpointId);
      const price = stabletravelPriceUsd(priceKind);
      const cap = stabletravelMaxUsd(maxKind);
      assert.equal(String(endpoint.estimated_cost_usd), price);
      assert.equal(endpoint.healthProbe.maxUsd, cap);
      assert.equal(endpoint.liveSmoke.default_path.max_usd, cap);
      assert.equal(endpoint.liveSmoke.paid_path.max_usd, cap);
      assert.ok(Number(cap) > Number(price));
      assert.match(endpoint.description, new RegExp(`\\$${price.replace(".", "\\.")}`));
      assert.match(endpoint.description, new RegExp(`\\$${cap.replace(".", "\\.")}`));
    }
  });
});
