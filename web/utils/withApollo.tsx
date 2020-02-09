import React from "react";
import {
  ApolloClient,
  ApolloLink,
  ApolloProvider,
  InMemoryCache,
  HttpLink,
  NormalizedCacheObject
} from "@apollo/client";
import { getDataFromTree } from "@apollo/react-ssr";
import Head from "next/head";
import fetch from "node-fetch";

import { getAccessToken } from "./accessToken";
import { NextPage, NextPageContext } from "next";

let globalApolloClient: ApolloClient<NormalizedCacheObject> | null = null;

/**
 * Creates and provides the apolloContext
 * to a next.js PageTree. Use it by wrapping
 * your PageComponent via HOC pattern.
 */
export const withApollo = ({ ssr = true } = {}) => (PageComponent: any) => {
  const WithApollo: React.FC<{
    apolloState?: any;
    apolloClient?: ApolloClient<NormalizedCacheObject>;
  }> = ({ apolloClient, apolloState, ...pageProps }) => {
    const client = apolloClient || initApolloClient(apolloState);

    return (
      <ApolloProvider client={client}>
        <PageComponent {...pageProps} />
      </ApolloProvider>
    );
  };

  // Set the correct displayName in development
  if (process.env.NODE_ENV !== "production") {
    const displayName =
      PageComponent.displayName || PageComponent.name || "Component";

    if (displayName === "App") {
      console.warn("This withApollo HOC only works with PageComponents.");
    }

    WithApollo.displayName = `withApollo(${displayName})`;
  }

  // PageComponent.getInitialProps

  const isPageComponentNextPage = (Component: any): Component is NextPage => {
    return !!Component.getInitialProps;
  };

  if (ssr || isPageComponentNextPage(PageComponent)) {
    (WithApollo as NextPage<{
      apolloState?: any;
      apolloClient?: ApolloClient<NormalizedCacheObject>;
    }>).getInitialProps = async (
      ctx: NextPageContext & {
        apolloClient: ApolloClient<NormalizedCacheObject>;
      }
    ) => {
      const { AppTree } = ctx;

      // Initialize ApolloClient, add it to the ctx object so
      // we can use it in `PageComponent.getInitialProp`.
      const apolloClient = (ctx.apolloClient = initApolloClient());

      // Run wrapped getInitialProps methods
      let pageProps = {};

      if (
        isPageComponentNextPage(PageComponent) &&
        PageComponent.getInitialProps
      ) {
        pageProps = await PageComponent.getInitialProps(ctx);
      }

      // Only on the server:
      if (typeof window === "undefined") {
        // When redirecting, the response is finished.
        // No point in continuing to render
        if (ctx.res && ctx.res.finished) {
          return pageProps;
        }

        // Only if ssr is enabled
        if (ssr) {
          try {
            // Run all GraphQL queries
            await getDataFromTree(
              <AppTree
                pageProps={{
                  ...pageProps,
                  apolloClient
                }}
              />
            );
          } catch (error) {
            // Prevent Apollo Client GraphQL errors from crashing SSR.
            // Handle them in components via the data.error prop:
            // https://www.apollographql.com/docs/react/api/react-apollo.html#graphql-query-data-error
            console.error("Error while running `getDataFromTree`", error);
          }

          // getDataFromTree does not call componentWillUnmount
          // head side effect therefore need to be cleared manually
          Head.rewind();
        }
      }

      // Extract query data from the Apollo store
      const apolloState = apolloClient.cache.extract();

      return {
        ...pageProps,
        apolloState
      };
    };
  }

  return WithApollo;
};

/**
 * Always creates a new apollo client on the server
 * Creates or reuses apollo client in the browser.
 * @param  {Object} initialState
 */
const initApolloClient = (initialState?: any) => {
  // Make sure to create a new client for every server-side request so that data
  // isn't shared between connections (which would be bad)
  if (typeof window === "undefined") {
    return createApolloClient(initialState);
  }

  // Reuse client on the client-side
  if (!globalApolloClient) {
    globalApolloClient = createApolloClient(initialState);
  }

  return globalApolloClient;
};

/**
 * Creates and configures the ApolloClient
 * @param  {Object} [initialState={}]
 */
const createApolloClient = (initialState: any = {}) => {
  const httpLink = new HttpLink({
    uri:
      typeof window === "undefined"
        ? "http://192.168.0.106:3050/api"
        : "http://localhost:3050/api",
    credentials: "include",
    fetch: fetch as any
  });

  const authLink = new ApolloLink((operation, forward) => {
    const accessToken = getAccessToken();

    if (accessToken) {
      operation.setContext({
        headers: {
          authorization: `bearer ${accessToken}`
        }
      });
    }

    return forward(operation);
  });

  const link = ApolloLink.from([authLink, httpLink]);

  return new ApolloClient({
    ssrMode: typeof window === "undefined",
    link,
    cache: new InMemoryCache().restore(initialState)
  });
};