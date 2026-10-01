# sonar-mutation-report-plugin

Language-agnostic SonarQube plugin. It runs no mutation testing. An external agent produces
`mutation-report.json`; this plugin reads it (`sonar.mutation.reportPath`) and publishes the
numbers as Sonar measures so a quality gate can use them.

Status: spike. Measures: `mutation_score`, `new_mutation_score`.

## Build

    mvn package        # jar in target/

If Maven fails with a PKIX error behind a corporate proxy:

    export MAVEN_OPTS="-Djavax.net.ssl.trustStoreType=KeychainStore -Djavax.net.ssl.trustStore=NONE"
