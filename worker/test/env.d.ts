declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    JWT_SECRET: string;
    DELIVERY_FEE: string;
    PICKUP_ENABLED: string;
    OSRM_URL: string;
    OSRM_USER_AGENT: string;
    ORS_URL: string;
    ORS_API_KEY?: string;
    DISPATCH: DurableObjectNamespace<import('../src/do/dispatch').Dispatch>;
    TRIP: DurableObjectNamespace<import('../src/do/trip').Trip>;
    PROOFS: R2Bucket;
    TEST_MIGRATIONS: D1Migration[];
  }
}
