-- Split the retired umbrella setting into dedicated bearer and OAuth settings.
-- Existing valid dedicated values remain authoritative when both forms are present.
UPDATE "Endpoint"
SET "profile" = (
    jsonb_set(
        jsonb_set(
            "profile"::jsonb,
            '{settings,SecretTokenBearerAuthEnabled}',
            CASE
                WHEN jsonb_typeof("profile"::jsonb #> '{settings,SecretTokenBearerAuthEnabled}') = 'boolean'
                  OR (
                      jsonb_typeof("profile"::jsonb #> '{settings,SecretTokenBearerAuthEnabled}') = 'string'
                      AND lower("profile"::jsonb #>> '{settings,SecretTokenBearerAuthEnabled}') IN ('true', 'false', '1', '0')
                  )
                    THEN "profile"::jsonb #> '{settings,SecretTokenBearerAuthEnabled}'
                WHEN jsonb_typeof("profile"::jsonb #> '{settings,PerEndpointCredentialsEnabled}') = 'boolean'
                  OR (
                      jsonb_typeof("profile"::jsonb #> '{settings,PerEndpointCredentialsEnabled}') = 'string'
                      AND lower("profile"::jsonb #>> '{settings,PerEndpointCredentialsEnabled}') IN ('true', 'false', '1', '0')
                  )
                    THEN "profile"::jsonb #> '{settings,PerEndpointCredentialsEnabled}'
                ELSE 'false'::jsonb
            END,
            true
        ),
        '{settings,OAuthClientCredentialsAuthEnabled}',
        CASE
            WHEN jsonb_typeof("profile"::jsonb #> '{settings,OAuthClientCredentialsAuthEnabled}') = 'boolean'
              OR (
                  jsonb_typeof("profile"::jsonb #> '{settings,OAuthClientCredentialsAuthEnabled}') = 'string'
                  AND lower("profile"::jsonb #>> '{settings,OAuthClientCredentialsAuthEnabled}') IN ('true', 'false', '1', '0')
              )
                THEN "profile"::jsonb #> '{settings,OAuthClientCredentialsAuthEnabled}'
            WHEN jsonb_typeof("profile"::jsonb #> '{settings,PerEndpointCredentialsEnabled}') = 'boolean'
              OR (
                  jsonb_typeof("profile"::jsonb #> '{settings,PerEndpointCredentialsEnabled}') = 'string'
                  AND lower("profile"::jsonb #>> '{settings,PerEndpointCredentialsEnabled}') IN ('true', 'false', '1', '0')
              )
                THEN "profile"::jsonb #> '{settings,PerEndpointCredentialsEnabled}'
            ELSE 'false'::jsonb
        END,
        true
    ) #- '{settings,PerEndpointCredentialsEnabled}'
)
WHERE jsonb_typeof("profile"::jsonb -> 'settings') = 'object'
  AND ("profile"::jsonb -> 'settings') ? 'PerEndpointCredentialsEnabled';
