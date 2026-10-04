-- Amplía los tipos de proveedor con los servicios compatibles con OpenAI más usados.
alter table proveedores_ia drop constraint if exists proveedores_ia_tipo_check;
alter table proveedores_ia add constraint proveedores_ia_tipo_check
  check (tipo in ('gemini','anthropic','openai','openrouter','nvidia','groq','deepseek','mistral','together','compatible'));
