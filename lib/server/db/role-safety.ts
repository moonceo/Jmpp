export interface DatabaseRoleSafety {
    rolsuper: boolean;
    rolbypassrls: boolean;
    member_of_table_owner: boolean;
    relrowsecurity: boolean;
}

export function isSafeApplicationDatabaseRole(
    role: DatabaseRoleSafety | undefined,
): boolean {
    return Boolean(
        role
        && !role.rolsuper
        && !role.rolbypassrls
        && !role.member_of_table_owner
        && role.relrowsecurity,
    );
}

export function isSafeWorkerDatabaseRole(
    role: DatabaseRoleSafety | undefined,
): boolean {
    return Boolean(
        role
        && !role.rolsuper
        && role.rolbypassrls
        && !role.member_of_table_owner,
    );
}

export const databaseRoleSafetySql = `
    SELECT role.rolsuper,
           role.rolbypassrls,
           pg_has_role(current_user, relation.relowner, 'MEMBER')
               AS member_of_table_owner,
           relation.relrowsecurity
      FROM pg_roles role
      JOIN pg_class relation
        ON relation.relname = 'sales_orders'
      JOIN pg_namespace namespace
        ON namespace.oid = relation.relnamespace
       AND namespace.nspname = 'public'
     WHERE role.rolname = current_user`;
