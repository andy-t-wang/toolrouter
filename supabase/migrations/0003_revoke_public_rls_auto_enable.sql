revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
revoke execute on function public.rls_auto_enable() from public;

comment on function public.rls_auto_enable() is
  'Execution revoked from anon and authenticated roles; callable only by privileged database roles.';
