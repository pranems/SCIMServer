// Deploy SCIMServer Container App referencing existing environment & ACR

@description('Location for deployment')
param location string = resourceGroup().location
@description('Container App name')
param appName string
@description('Managed Environment name (should exist or be deployed via containerapp-env.bicep)')
param environmentName string
@description('ACR login server (e.g. myacr.azurecr.io)')
param acrLoginServer string
@description('Image tag to deploy (e.g. scimserver/api:latest)')
param image string
@description('SCIM shared secret')
@secure()
param scimSharedSecret string
@description('JWT signing secret used to issue OAuth tokens')
@secure()
param jwtSecret string
@description('OAuth client secret required when requesting SCIMServer tokens')
@secure()
param oauthClientSecret string
@description('PostgreSQL connection string (e.g. postgresql://user:pass@host:5432/db). Required for Phase 3.')
@secure()
param databaseUrl string
@description('Target port inside container')
param targetPort int = 8080
@description('Min replicas')
param minReplicas int = 1
@description('Max replicas – set to 1 for single-instance deployments; increase to 3+ with a shared PostgreSQL database for HA.')
param maxReplicas int = 1
@description('CPU cores per replica (allowed: 0.25,0.5,1,2). Use 1 for reliability if unsure.')
@allowed([
  '0.25'
  '0.5'
  '1'
  '2'
])
param cpuCores string = '0.5'
@description('Optional memory per replica')
param memory string = '1Gi'
@description('GHCR username for pulling container images (optional, only for private packages)')
param ghcrUsername string = ''
@description('GHCR PAT token for pulling container images (optional, only for private packages)')
@secure()
param ghcrPassword string = ''

var useGhcrCredentials = acrLoginServer == 'ghcr.io' && ghcrUsername != '' && ghcrPassword != ''

resource env 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: environmentName
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  properties: {
    environmentId: env.id
    // workloadProfileName omitted - uses default consumption model
    configuration: {
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
      }
      // Configure registry authentication
      registries: useGhcrCredentials ? [
        {
          server: 'ghcr.io'
          username: ghcrUsername
          passwordSecretRef: 'ghcr-password'
        }
      ] : acrLoginServer != 'ghcr.io' ? [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ] : []
      secrets: concat([
        {
          name: 'scim-shared-secret'
          value: scimSharedSecret
        }
        {
          name: 'jwt-secret'
          value: jwtSecret
        }
        {
          name: 'oauth-client-secret'
          value: oauthClientSecret
        }
        {
          name: 'database-url'
          value: databaseUrl
        }
      ], useGhcrCredentials ? [
        {
          name: 'ghcr-password'
          value: ghcrPassword
        }
      ] : [])
    }
    template: {
      // Init container only cleans Azure Files journal artifacts now; main container handles restore to /tmp
      initContainers: []
      containers: [
        {
          name: 'scimserver'
          image: '${acrLoginServer}/${image}'
          env: [
            { name: 'SCIM_SHARED_SECRET', secretRef: 'scim-shared-secret' }
            { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
            { name: 'OAUTH_CLIENT_SECRET', secretRef: 'oauth-client-secret' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'PERSISTENCE_BACKEND', value: 'prisma' }
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: string(targetPort) }
            // Metadata for in-app "Copy Update Command" (avoids discovery in update script)
            { name: 'SCIM_RG', value: resourceGroup().name }
            { name: 'SCIM_APP', value: appName }
            { name: 'SCIM_REGISTRY', value: acrLoginServer }
            { name: 'SCIM_CURRENT_IMAGE', value: '${acrLoginServer}/${image}' }
            // ── Production logging defaults ──
            // DEBUG captures full request lifecycle (→/←) for diagnosis;
            // bodies are still persisted in RequestLog DB — no need for console payloads.
            { name: 'LOG_LEVEL', value: 'DEBUG' }
            { name: 'LOG_FORMAT', value: 'json' }
            { name: 'LOG_FILE', value: '' }          // disable file logging (ephemeral container disk)
            { name: 'LOG_RING_BUFFER_SIZE', value: '5000' }
            { name: 'LOG_RETENTION_DAYS', value: '30' }
            { name: 'LOG_SLOW_REQUEST_MS', value: '1000' }
          ]
          resources: {
            cpu: json(cpuCores)
            memory: memory
          }
          probes: [
            {
              // Allow up to (10 + 5*30) = 160s for prisma migrate deploy + boot
              type: 'Startup'
              httpGet: {
                path: '/health'
                port: targetPort
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
              periodSeconds: 5
              timeoutSeconds: 3
              failureThreshold: 30
              successThreshold: 1
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: targetPort
                scheme: 'HTTP'
              }
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: targetPort
                scheme: 'HTTP'
              }
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 3
              successThreshold: 1
            }
          ]
          volumeMounts: []
        }
      ]
      // Phase 3 (PostgreSQL): maxReplicas can be increased for HA once DATABASE_URL points to
      // a shared PostgreSQL instance (e.g. Azure Database for PostgreSQL Flexible Server).
      // With a single-instance external PG (or managed PG) multiple replicas are safe.
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
      volumes: []
    }
  }
  identity: {
    type: 'SystemAssigned'
  }
  tags: {
    project: 'scimserver'
  }
}

output containerAppFqdn string = app.properties.configuration.ingress.fqdn
