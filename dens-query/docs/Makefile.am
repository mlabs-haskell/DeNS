doc_DATA = index.html

index.html: MANUAL.adoc GETTING_STARTED.adoc HTTP_API.adoc DATABASE_SCHEMA.adoc 
	$(ASCIIDOCTOR) $< -o $@
